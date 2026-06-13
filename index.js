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
  StringSelectMenuBuilder,
  PermissionsBitField
} from "discord.js";

import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import { MercadoPagoConfig, Payment } from "mercadopago";

/* ================= CONFIG ================= */

const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  mpToken: process.env.MP_TOKEN,
  logChannelId: process.env.LOG_CHANNEL_ID,
  ticketCategoryId: process.env.TICKET_CATEGORY_ID,
  adminRoleId: process.env.ADMIN_ROLE_ID
};

const productsFile = "./data/products.json";

const mpClient = new MercadoPagoConfig({
  accessToken: config.mpToken
});
const paymentClient = new Payment(mpClient);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let carrinhos = {};
let pagamentos = {};

/* ================= FUNÇÕES ================= */

function getProducts() {
  return JSON.parse(fs.readFileSync(productsFile));
}

function saveProducts(data) {
  fs.writeFileSync(productsFile, JSON.stringify(data, null, 2));
}

function formatarValor(valor) {
  return valor.toFixed(2).replace(".", ",");
}

/* ================= COMANDOS ================= */

const commands = [
  new SlashCommandBuilder()
    .setName("criar-produto")
    .setDescription("Criar um novo produto na loja")
    .addStringOption(o =>
      o.setName("nome")
        .setDescription("Nome do produto")
        .setRequired(true)
    )
    .addNumberOption(o =>
      o.setName("preco")
        .setDescription("Preço do produto")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("estoque")
        .setDescription("Quantidade em estoque")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("link")
        .setDescription("Link do produto")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Criar painel profissional da loja")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

client.once("ready", async () => {
  console.log("✅ Awakening Store Online");

  await rest.put(
    Routes.applicationCommands(config.clientId),
    { body: commands }
  );
});

/* ================= INTERAÇÕES ================= */

client.on("interactionCreate", async interaction => {

  /* ========= COMANDOS ========= */

  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "criar-produto") {

      if (!interaction.member.roles.cache.has(config.adminRoleId))
        return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });

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

      const embed = new EmbedBuilder()
        .setTitle("🛒 AWAKENING STORE")
        .setDescription("Selecione o produto abaixo para iniciar a compra.")
        .setColor("#00ff88");

      const row = new ActionRowBuilder();

      data.products.forEach(p => {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`buy_${p.id}`)
            .setLabel(`🛒 ${p.nome}`)
            .setStyle(ButtonStyle.Success)
        );
      });

      await interaction.channel.send({ embeds: [embed], components: [row] });

      return interaction.reply({ content: "✅ Painel criado!", ephemeral: true });
    }
  }

  /* ========= BOTÃO COMPRAR ========= */

  if (interaction.isButton() && interaction.customId.startsWith("buy_")) {

    await interaction.deferReply({ ephemeral: true });

    const productId = interaction.customId.replace("buy_", "");
    const data = getProducts();
    const produto = data.products.find(p => p.id === productId);

    if (!produto)
      return interaction.editReply({ content: "❌ Produto não encontrado." });

    const canal = await interaction.guild.channels.create({
      name: `compra-${interaction.user.username}`,
      type: ChannelType.GuildText,
      parent: config.ticketCategoryId,
      permissionOverwrites: [
        {
          id: interaction.guild.id,
          deny: [PermissionsBitField.Flags.ViewChannel]
        },
        {
          id: interaction.user.id,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
        },
        {
          id: config.adminRoleId,
          allow: [PermissionsBitField.Flags.ViewChannel]
        }
      ]
    });

    carrinhos[canal.id] = {
      userId: interaction.user.id,
      produtoId: produto.id,
      quantidade: 1
    };

    const embed = new EmbedBuilder()
      .setTitle("🛍 Confirme sua Compra")
      .setDescription(
        `📦 Produto: **${produto.nome}**\n\n` +
        `💰 Preço unitário: R$${formatarValor(produto.preco)}\n` +
        `📦 Estoque disponível: ${produto.estoque}\n\n` +
        `Selecione a quantidade abaixo.`
      )
      .setColor("#00ff88");

    const menu = new StringSelectMenuBuilder()
      .setCustomId("quantidade")
      .setPlaceholder("Selecionar quantidade")
      .addOptions(
        Array.from({ length: Math.min(produto.estoque, 10) }, (_, i) => ({
          label: `${i + 1}`,
          value: `${i + 1}`
        }))
      );

    const confirmBtn = new ButtonBuilder()
      .setCustomId("confirmar")
      .setLabel("✅ Confirmar Compra")
      .setStyle(ButtonStyle.Primary);

    await canal.send({
      content: `<@${interaction.user.id}>`,
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(menu),
        new ActionRowBuilder().addComponents(confirmBtn)
      ]
    });

    await interaction.editReply({ content: `✅ Ticket criado: ${canal}` });
  }

  /* ========= ALTERAR QUANTIDADE ========= */

  if (interaction.isStringSelectMenu() && interaction.customId === "quantidade") {

    const carrinho = carrinhos[interaction.channel.id];
    const data = getProducts();
    const produto = data.products.find(p => p.id === carrinho.produtoId);

    carrinho.quantidade = parseInt(interaction.values[0]);

    const total = produto.preco * carrinho.quantidade;

    const embed = new EmbedBuilder()
      .setTitle("🛍 Confirme sua Compra")
      .setDescription(
        `📦 Produto: **${produto.nome}**\n\n` +
        `📦 Quantidade: ${carrinho.quantidade}\n` +
        `💰 Total: R$${formatarValor(total)}`
      )
      .setColor("#00ff88");

    await interaction.update({ embeds: [embed] });
  }

  /* ========= CONFIRMAR PAGAMENTO ========= */

  if (interaction.isButton() && interaction.customId === "confirmar") {

    await interaction.deferReply();

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
      .setTitle("💳 PAGAMENTO VIA PIX")
      .setDescription(
        `Escaneie o QR Code abaixo.\n\n` +
        `Ou copie o código:\n\n\`\`\`\n${pagamento.point_of_interaction.transaction_data.qr_code}\n\`\`\`\n\n` +
        `📌 Passo a passo:\n` +
        `1️⃣ Abra seu banco\n` +
        `2️⃣ Vá em Pix\n` +
        `3️⃣ Escaneie o QR Code\n` +
        `4️⃣ Confirme o pagamento`
      )
      .setImage("attachment://qrcode.png")
      .setColor("#00ff88");

    await interaction.editReply({
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
    await user.send(`✅ Pagamento aprovado!\nAqui está seu produto:\n${produto.link}`);

    const canal = await client.channels.fetch(info.canalId);
    await canal.send("✅ Pagamento confirmado! Produto enviado na DM.");

    const log = await client.channels.fetch(config.logChannelId);
    await log.send(`💰 Venda: ${produto.nome} x${info.quantidade}`);

    delete pagamentos[paymentId];
  }

  res.sendStatus(200);
});

app.listen(3000);
client.login(config.token);