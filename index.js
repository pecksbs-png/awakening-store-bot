import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";

import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import { MercadoPagoConfig, Payment } from "mercadopago";

const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  mercadoPagoToken: process.env.MP_TOKEN,
  logChannelId: process.env.LOG_CHANNEL_ID
};

const store = JSON.parse(fs.readFileSync("./store.json"));
const productsFile = "./products.json";

const mpClient = new MercadoPagoConfig({
  accessToken: config.mercadoPagoToken
});
const paymentClient = new Payment(mpClient);

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let pagamentos = {};

function getProducts() {
  return JSON.parse(fs.readFileSync(productsFile));
}

function saveProducts(data) {
  fs.writeFileSync(productsFile, JSON.stringify(data, null, 2));
}

function isAdmin(member) {
  return member.roles.cache.has(store.adminRoleId);
}

/* ================= COMANDOS ================= */

const commands = [
  new SlashCommandBuilder()
    .setName("criar-produto")
    .setDescription("Criar novo produto")
    .addStringOption(o => o.setName("nome").setDescription("Nome").setRequired(true))
    .addNumberOption(o => o.setName("preco").setDescription("Preço").setRequired(true))
    .addIntegerOption(o => o.setName("estoque").setDescription("Estoque").setRequired(true))
    .addStringOption(o => o.setName("link").setDescription("Link").setRequired(true)),

  new SlashCommandBuilder()
    .setName("criar-painel")
    .setDescription("Criar painel da loja")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

client.once("ready", async () => {
  console.log(`✅ Online como ${client.user.tag}`);

  await rest.put(
    Routes.applicationCommands(config.clientId),
    { body: commands }
  );
});

/* ================= INTERAÇÕES ================= */

client.on("interactionCreate", async interaction => {

  if (interaction.isChatInputCommand()) {

    if (!isAdmin(interaction.member))
      return interaction.reply({ content: "❌ Você não tem permissão.", ephemeral: true });

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

      return interaction.reply({ content: `✅ Produto ${produto.nome} criado!`, ephemeral: true });
    }

    if (interaction.commandName === "criar-painel") {

      const data = getProducts();

      if (data.products.length === 0)
        return interaction.reply({ content: "❌ Nenhum produto cadastrado.", ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle(`🛒 ${store.storeName}`)
        .setColor(store.embedColor)
        .setDescription("Clique no botão para comprar.");

      const row = new ActionRowBuilder();

      data.products.forEach(prod => {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`buy_${prod.id}`)
            .setLabel(prod.nome)
            .setStyle(ButtonStyle.Success)
        );
      });

      await interaction.channel.send({ embeds: [embed], components: [row] });

      return interaction.reply({ content: "✅ Painel criado!", ephemeral: true });
    }
  }

  /* ================= BOTÃO DE COMPRA ================= */

  if (interaction.isButton()) {

    const productId = interaction.customId.replace("buy_", "");
    const data = getProducts();
    const produto = data.products.find(p => p.id === productId);

    if (!produto)
      return interaction.reply({ content: "❌ Produto não encontrado.", ephemeral: true });

    if (produto.estoque <= 0)
      return interaction.reply({ content: "❌ Produto sem estoque.", ephemeral: true });

    const pagamento = await paymentClient.create({
      body: {
        transaction_amount: produto.preco,
        description: produto.nome,
        payment_method_id: "pix",
        payer: { email: "cliente@email.com" }
      }
    });

    pagamentos[pagamento.id] = {
      userId: interaction.user.id,
      produtoId: produto.id
    };

    const qr = pagamento.point_of_interaction.transaction_data.qr_code;

    await interaction.reply({
      content: `💳 Pague via Pix:\n\`\`\`\n${qr}\n\`\`\`\n✅ Após o pagamento o produto será entregue automaticamente.`,
      ephemeral: true
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

    produto.estoque -= 1;
    saveProducts(data);

    const user = await client.users.fetch(info.userId);
    await user.send(`✅ Pagamento aprovado!\nAqui está seu produto:\n${produto.link}`);

    const logChannel = await client.channels.fetch(config.logChannelId);
    await logChannel.send(`💰 Venda realizada!\nProduto: ${produto.nome}`);

    delete pagamentos[paymentId];
  }

  res.sendStatus(200);
});

app.listen(3000);
client.login(config.token);