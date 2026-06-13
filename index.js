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
  PermissionsBitField,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder
} from "discord.js";

import fs from "fs";
import express from "express";
import bodyParser from "body-parser";
import { MercadoPagoConfig, Payment } from "mercadopago";

/* ================= CONFIG ================= */

const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  mpToken: process.env.MP_TOKEN,
  adminRoleId: process.env.ADMIN_ROLE_ID,
  ticketCategoryId: process.env.TICKET_CATEGORY_ID,
  logChannelId: process.env.LOG_CHANNEL_ID
};

const productsPath = "./data/products.json";
const statsPath = "./data/stats.json";

/* ================= JSON ================= */

function ensure(path, defaultData) {
  if (!fs.existsSync("./data")) fs.mkdirSync("./data");
  if (!fs.existsSync(path))
    fs.writeFileSync(path, JSON.stringify(defaultData, null, 2));
}

function getProducts() {
  ensure(productsPath, { products: [] });
  return JSON.parse(fs.readFileSync(productsPath));
}

function saveProducts(data) {
  fs.writeFileSync(productsPath, JSON.stringify(data, null, 2));
}

function getStats() {
  ensure(statsPath, { sales: [] });
  return JSON.parse(fs.readFileSync(statsPath));
}

function saveStats(data) {
  fs.writeFileSync(statsPath, JSON.stringify(data, null, 2));
}

function formatar(v) {
  return v.toFixed(2).replace(".", ",");
}

/* ================= MERCADO PAGO ================= */

const mpClient = new MercadoPagoConfig({ accessToken: config.mpToken });
const paymentClient = new Payment(mpClient);

/* ================= DISCORD ================= */

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let carrinhos = {};
let pagamentos = {};

/* ================= COMANDOS ================= */

const commands = [
  new SlashCommandBuilder()
    .setName("criar-produto")
    .setDescription("Criar produto")
    .addStringOption(o => o.setName("nome").setDescription("Nome").setRequired(true))
    .addStringOption(o => o.setName("descricao").setDescription("Descrição").setRequired(true))
    .addNumberOption(o => o.setName("preco").setDescription("Preço").setRequired(true))
    .addIntegerOption(o => o.setName("estoque").setDescription("Estoque").setRequired(true))
    .addStringOption(o => o.setName("link").setDescription("Link").setRequired(true)),

  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Criar painel"),

  new SlashCommandBuilder()
    .setName("top")
    .setDescription("Ver top compradores")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

client.once("ready", async () => {
  console.log("✅ Loja Final Online");
  await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
});

/* ================= INTERAÇÕES ================= */

client.on("interactionCreate", async interaction => {

  try {

    /* ===== COMANDOS ===== */

    if (interaction.isChatInputCommand()) {

      await interaction.deferReply({ ephemeral: true });

      if (interaction.commandName === "criar-produto") {

        if (!interaction.member.roles.cache.has(config.adminRoleId))
          return interaction.editReply({ content: "❌ Sem permissão." });

        const data = getProducts();

        data.products.push({
          id: Date.now().toString(),
          nome: interaction.options.getString("nome"),
          descricao: interaction.options.getString("descricao"),
          preco: interaction.options.getNumber("preco"),
          estoque: interaction.options.getInteger("estoque"),
          link: interaction.options.getString("link")
        });

        saveProducts(data);
        return interaction.editReply({ content: "✅ Produto criado!" });
      }

      if (interaction.commandName === "painel") {

        const data = getProducts();
        if (!data.products.length)
          return interaction.editReply({ content: "❌ Sem produtos." });

        for (const p of data.products) {

          const embed = new EmbedBuilder()
            .setTitle(`🛍 ${p.nome}`)
            .setDescription(
              `${p.descricao}\n\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `💰 **Valor:** R$ ${formatar(p.preco)}\n` +
              `📦 **Estoque:** ${p.estoque}\n` +
              `━━━━━━━━━━━━━━━━━━`
            )
            .setColor("#00ff88")
            .setFooter({ text: "Awakening Store • Entrega automática" });

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`buy_${p.id}`)
              .setLabel("🛒 Comprar")
              .setStyle(ButtonStyle.Success)
          );

          await interaction.channel.send({ embeds: [embed], components: [row] });
        }

        return interaction.editReply({ content: "✅ Painel criado!" });
      }

      if (interaction.commandName === "top") {

        const stats = getStats();
        const ranking = stats.sales.reduce((acc, sale) => {
          acc[sale.user] = (acc[sale.user] || 0) + sale.total;
          return acc;
        }, {});

        const sorted = Object.entries(ranking)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);

        if (!sorted.length)
          return interaction.editReply({ content: "❌ Sem vendas ainda." });

        let desc = "";
        sorted.forEach((r, i) => {
          desc += `🏆 ${i + 1}. <@${r[0]}> — R$ ${formatar(r[1])}\n`;
        });

        return interaction.editReply({ content: desc });
      }
    }

    /* ===== BOTÃO COMPRAR ===== */

    if (interaction.isButton() && interaction.customId.startsWith("buy_")) {

      await interaction.deferReply({ ephemeral: true });

      const productId = interaction.customId.replace("buy_", "");
      const data = getProducts();
      const produto = data.products.find(p => p.id === productId);

      const canal = await interaction.guild.channels.create({
        name: `compra-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: config.ticketCategoryId,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          { id: config.adminRoleId, allow: [PermissionsBitField.Flags.ViewChannel] }
        ]
      });

      carrinhos[canal.id] = {
        produtoId: produto.id,
        userId: interaction.user.id
      };

      const embed = new EmbedBuilder()
        .setTitle("🛒 FINALIZAR COMPRA")
        .setDescription(
          `📦 Produto: **${produto.nome}**\n\n` +
          `💰 Valor unitário: R$ ${formatar(produto.preco)}\n\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `✏️ Clique em **Inserir Quantidade** para continuar.\n` +
          `🔒 Ou feche o ticket.\n` +
          `━━━━━━━━━━━━━━━━━━`
        )
        .setColor("#00ff88");

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("inserir_qtd")
          .setLabel("✏️ Inserir Quantidade")
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId("fechar_ticket")
          .setLabel("🔒 Fechar Ticket")
          .setStyle(ButtonStyle.Danger)
      );

      await canal.send({
        content: `<@${interaction.user.id}>`,
        embeds: [embed],
        components: [row]
      });

      return interaction.editReply({ content: `✅ Ticket criado: ${canal}` });
    }

  } catch (err) {
    console.error("ERRO FINAL:", err);
    if (!interaction.replied)
      interaction.reply({ content: "❌ Erro interno.", ephemeral: true });
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

    const stats = getStats();
    stats.sales.push({ user: info.userId, total: info.total });
    saveStats(stats);

    const user = await client.users.fetch(info.userId);
    await user.send(`✅ Pagamento aprovado!\nProduto:\n${produto.link}`);

    const canal = await client.channels.fetch(info.canalId);
    await canal.send("✅ Pagamento confirmado! Ticket será fechado.");
    setTimeout(() => canal.delete().catch(() => {}), 10000);

    const log = await client.channels.fetch(config.logChannelId);
    await log.send(`💰 Venda confirmada: ${produto.nome} x${info.quantidade}`);

    delete pagamentos[paymentId];
  }

  res.sendStatus(200);
});

app.listen(3000);
client.login(config.token);