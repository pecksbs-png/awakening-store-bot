import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  AttachmentBuilder,
  StringSelectMenuBuilder
} from "discord.js";

import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import { MercadoPagoConfig, Payment } from "mercadopago";

/* ================= CONFIG ================= */

const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  mercadoPagoToken: process.env.MP_TOKEN,
  logChannelId: process.env.LOG_CHANNEL_ID,
  ticketCategoryId: process.env.TICKET_CATEGORY_ID
};

const productsFile = "./data/products.json";

const mpClient = new MercadoPagoConfig({
  accessToken: config.mercadoPagoToken
});
const paymentClient = new Payment(mpClient);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let pagamentos = {};
let carrinhos = {};

/* ================= FUNÇÕES ================= */

function getProducts() {
  return JSON.parse(fs.readFileSync(productsFile));
}

function saveProducts(data) {
  fs.writeFileSync(productsFile, JSON.stringify(data, null, 2));
}

function gerarEmbedLoja(produtos) {
  return new EmbedBuilder()
    .setTitle("🛒 Awakening Store")
    .setDescription("Clique em comprar para iniciar.")
    .setColor("#00ff88");
}

/* ================= COMANDOS ================= */

const commands = [
  new SlashCommandBuilder()
    .setName("criar-produto")
    .setDescription("Criar produto")
    .addStringOption(o => o.setName("nome").setRequired(true).setDescription("Nome"))
    .addNumberOption(o => o.setName("preco").setRequired(true).setDescription("Preço"))
    .addIntegerOption(o => o.setName("estoque").setRequired(true).setDescription("Estoque"))
    .addStringOption(o => o.setName("link").setRequired(true).setDescription("Link")),

  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Criar painel da loja")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

client.once("ready", async () => {
  console.log("✅ Online");

  await rest.put(
    Routes.applicationCommands(config.clientId),
    { body: commands }
  );
});

/* ================= INTERAÇÕES ================= */

client.on("interactionCreate", async interaction => {

  /* ====== COMANDOS ====== */

  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "criar-produto") {

      const data = getProducts();

      const produto = {
        id: Date.now().toString(),
        nome: interaction.options.getString("nome"),
        preco: interaction.options.getNumber("preco"),
        estoque: interaction.options.getInteger("estoque"),
        link: interaction.options.getString("link")
      };

      data.products.push(produto);
      saveProducts(data);

      return interaction.reply({ content: "✅ Produto criado!", ephemeral: true });
    }

    if (interaction.commandName === "painel") {

      const data = getProducts();
      if (data.products.length === 0)
        return interaction.reply({ content: "❌ Sem produtos.", ephemeral: true });

      const embed = gerarEmbedLoja(data.products);

      const row = new ActionRowBuilder();

      data.products.forEach(p => {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`buy_${p.id}`)
            .setLabel(p.nome)
            .setStyle(ButtonStyle.Success)
        );
      });

      await interaction.channel.send({
        embeds: [embed],
        components: [row]
      });

      return interaction.reply({ content: "✅ Painel criado!", ephemeral: true });
    }
  }

  /* ====== BOTÃO COMPRAR ====== */

  if (interaction.isButton() && interaction.customId.startsWith("buy_")) {

    const productId = interaction.customId.replace("buy_", "");
    const data = getProducts();
    const produto = data.products.find(p => p.id === productId);

    if (!produto)
      return interaction.reply({ content: "❌ Produto não encontrado.", ephemeral: true });

    const canal = await interaction.guild.channels.create({
      name: `compra-${interaction.user.username}`,
      type: ChannelType.GuildText,
      parent: config.ticketCategoryId,
      permissionOverwrites: [
        {
          id: interaction.guild.id,
          deny: ["ViewChannel"]
        },
        {
          id: interaction.user.id,
          allow: ["ViewChannel", "SendMessages"]
        }
      ]
    });

    carrinhos[canal.id] = {
      userId: interaction.user.id,
      produtoId: produto.id,
      quantidade: 1
    };

    const embed = new EmbedBuilder()
      .setTitle("🛒 Confirme sua compra")
      .setDescription(
        `Produto: **${produto.nome}**\n\nQuantidade: 1\nPreço unitário: R$${produto.preco}\n\nUse o menu abaixo para alterar a quantidade.`
      )
      .setColor("#00ff88");

    const menu = new StringSelectMenuBuilder()
      .setCustomId("quantidade")
      .setPlaceholder("Escolha a quantidade")
      .addOptions(
        Array.from({ length: 10 }, (_, i) => ({
          label: `${i + 1}`,
          value: `${i + 1}`
        }))
      );

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("confirmar_compra")
        .setLabel("✅ Confirmar")
        .setStyle(ButtonStyle.Primary)
    );

    await canal.send({
      content: `<@${interaction.user.id}>`,
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(menu),
        confirmRow
      ]
    });

    return interaction.reply({
      content: `✅ Ticket criado: ${canal}`,
      ephemeral: true
    });
  }

  /* ====== ALTERAR QUANTIDADE ====== */

  if (interaction.isStringSelectMenu() && interaction.customId === "quantidade") {

    const quantidade = parseInt(interaction.values[0]);
    const carrinho = carrinhos[interaction.channel.id];
    const data = getProducts();
    const produto = data.products.find(p => p.id === carrinho.produtoId);

    carrinho.quantidade = quantidade;

    const total = produto.preco * quantidade;

    const embed = new EmbedBuilder()
      .setTitle("🛒 Confirme sua compra")
      .setDescription(
        `Produto: **${produto.nome}**\n\nQuantidade: ${quantidade}\nPreço unitário: R$${produto.preco}\n\n💰 Total: R$${total}`
      )
      .setColor("#00ff88");

    await interaction.update({ embeds: [embed] });
  }

  /* ====== CONFIRMAR COMPRA ====== */

  if (interaction.isButton() && interaction.customId === "confirmar_compra") {

    const carrinho = carrinhos[interaction.channel.id];
    const data = getProducts();
    const produto = data.products.find(p => p.id === carrinho.produtoId);

    const total = produto.preco * carrinho.quantidade;

    const pagamento = await paymentClient.create({
      body: {
        transaction_amount: total,
        description: produto.nome,
        payment_method_id: "pix",
        payer: { email: "cliente@email.com" }
      }
    });

    pagamentos[pagamento.id] = {
      userId: carrinho.userId,
      produtoId: produto.id,
      quantidade: carrinho.quantidade,
      canalId: interaction.channel.id
    };

    const qrBase64 = pagamento.point_of_interaction.transaction_data.qr_code_base64;
    const qrBuffer = Buffer.from(qrBase64, "base64");
    const attachment = new AttachmentBuilder(qrBuffer, { name: "qrcode.png" });

    const embed = new EmbedBuilder()
      .setTitle("💳 Pagamento via Pix")
      .setDescription(
        `✅ Escaneie o QR Code acima\n\nOu copie o código abaixo:\n\n\`\`\`\n${pagamento.point_of_interaction.transaction_data.qr_code}\n\`\`\`\n\n📌 Passo a passo:\n1. Abra seu app do banco\n2. Vá em Pix\n3. Escanear QR Code\n4. Confirme pagamento`
      )
      .setImage("attachment://qrcode.png")
      .setColor("#00ff88");

    await interaction.reply({
      embeds: [embed],
      files: [attachment]
    });
  }
});

/* ================= WEBHOOK ================= */

const app = express();
app.use(bodyParser.json());

app.post("/webhook", async (req, res) => {

  const paymentId = req.body?.data?.id;
  if (!paymentId) return res.sendStatus(200);

  const pagamentoInfo = await paymentClient.get({ id: paymentId });

  if (pagamentoInfo.status === "approved") {

    const info = pagamentos[paymentId];
    if (!info) return res.sendStatus(200);

    const data = getProducts();
    const produto = data.products.find(p => p.id === info.produtoId);

    produto.estoque -= info.quantidade;
    saveProducts(data);

    const user = await client.users.fetch(info.userId);
    await user.send(
      `✅ Pagamento aprovado!\nAqui está seu produto:\n${produto.link}`
    );

    const canal = await client.channels.fetch(info.canalId);
    await canal.send("✅ Pagamento aprovado! Produto enviado na DM.");

    const logChannel = await client.channels.fetch(config.logChannelId);
    await logChannel.send(`💰 Venda: ${produto.nome} x${info.quantidade}`);

    delete pagamentos[paymentId];
  }

  res.sendStatus(200);
});

app.listen(3000);
client.login(config.token);