// ================= IMPORTS =================
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

// ================= CONFIG =================

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
  return Number(v || 0).toFixed(2).replace(".", ",");
}

// ================= MERCADO PAGO =================

const mpClient = new MercadoPagoConfig({
  accessToken: config.mpToken
});
const paymentClient = new Payment(mpClient);

// ================= DISCORD =================

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let carrinhos = {};
let pagamentos = {};

// ================= COMANDOS =================

const commands = [
  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Criar painel da loja"),

  new SlashCommandBuilder()
    .setName("top")
    .setDescription("Ver top compradores")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

client.once("ready", async () => {
  console.log("✅ SISTEMA FINAL ONLINE");
  await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
});

// ================= INTERAÇÕES =================

client.on("interactionCreate", async interaction => {

  try {

    // ===== PAINEL =====
    if (interaction.isChatInputCommand()) {

      await interaction.deferReply({ ephemeral: true });

      if (interaction.commandName === "painel") {

        const data = getProducts();
        if (!data.products.length)
          return interaction.editReply({ content: "❌ Sem produtos." });

        for (const p of data.products) {

          const embed = new EmbedBuilder()
            .setTitle(`🛍 ${p.nome}`)
            .setDescription(
              `${p.descricao}\n\n` +
              `💰 Valor: R$ ${formatar(p.preco)}\n` +
              `📦 Estoque: ${p.estoque}`
            )
            .setColor("#00ff88");

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

      // ===== TOP =====
      if (interaction.commandName === "top") {

        const stats = getStats();
        const ranking = stats.sales.reduce((acc, s) => {
          acc[s.user] = (acc[s.user] || 0) + s.total;
          return acc;
        }, {});

        const sorted = Object.entries(ranking)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);

        if (!sorted.length)
          return interaction.editReply({ content: "❌ Sem vendas." });

        let desc = "";
        sorted.forEach((r, i) => {
          desc += `🏆 ${i + 1}. <@${r[0]}> — R$ ${formatar(r[1])}\n`;
        });

        return interaction.editReply({ content: desc });
      }
    }

    // ===== BOTÃO COMPRAR =====
    if (interaction.isButton() && interaction.customId.startsWith("buy_")) {

      await interaction.deferReply({ ephemeral: true });

      const id = interaction.customId.replace("buy_", "");
      const produto = getProducts().products.find(p => p.id === id);

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

      await canal.send(
        `✅ Ticket criado para **${produto.nome}**.\nClique no botão abaixo para inserir quantidade.`,
        {
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("inserir_qtd")
                .setLabel("Inserir Quantidade")
                .setStyle(ButtonStyle.Primary)
            )
          ]
        }
      );

      return interaction.editReply({ content: `✅ Ticket criado: ${canal}` });
    }

    // ===== MODAL QUANTIDADE =====
    if (interaction.isButton() && interaction.customId === "inserir_qtd") {

      const modal = new ModalBuilder()
        .setCustomId("modal_qtd")
        .setTitle("Quantidade");

      const input = new TextInputBuilder()
        .setCustomId("quantidade_input")
        .setLabel("Digite a quantidade desejada")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === "modal_qtd") {

      await interaction.deferReply();

      const qtd = parseInt(interaction.fields.getTextInputValue("quantidade_input"));
      const carrinho = carrinhos[interaction.channel.id];
      const produto = getProducts().products.find(p => p.id === carrinho.produtoId);

      if (isNaN(qtd) || qtd <= 0 || qtd > produto.estoque)
        return interaction.editReply({ content: "❌ Quantidade inválida." });

      const total = produto.preco * qtd;

      const pagamento = await paymentClient.create({
        body: {
          transaction_amount: total,
          description: produto.nome,
          payment_method_id: "pix",
          payer: { email: "cliente@email.com" }
        }
      });

      pagamentos[pagamento.id] = {
        produtoId: produto.id,
        quantidade: qtd,
        userId: interaction.user.id,
        canalId: interaction.channel.id,
        total: total
      };

      const qrBase64 = pagamento.point_of_interaction.transaction_data.qr_code_base64;
      const qrBuffer = Buffer.from(qrBase64, "base64");
      const attachment = new AttachmentBuilder(qrBuffer, { name: "qrcode.png" });

      const embed = new EmbedBuilder()
        .setTitle("💳 PAGAMENTO VIA PIX")
        .setDescription(
          `💰 Valor total: R$ ${formatar(total)}\n\n` +
          `Escaneie o QR Code abaixo.\n\n` +
          `Código:\n\n\`\`\`\n${pagamento.point_of_interaction.transaction_data.qr_code}\n\`\`\``
        )
        .setImage("attachment://qrcode.png")
        .setColor("#00ff88");

      return interaction.editReply({
        embeds: [embed],
        files: [attachment]
      });
    }

  } catch (err) {
    console.error("ERRO FINAL:", err);
    if (!interaction.replied)
      interaction.reply({ content: "❌ Erro interno.", ephemeral: true });
  }
});

// ===== WEBHOOK =====

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