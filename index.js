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

/* ================= JSON ================= */

function garantirJSON() {
  if (!fs.existsSync("./data")) fs.mkdirSync("./data");
  if (!fs.existsSync(productsPath))
    fs.writeFileSync(productsPath, JSON.stringify({ products: [] }, null, 2));
}

function getProducts() {
  garantirJSON();
  return JSON.parse(fs.readFileSync(productsPath));
}

function saveProducts(data) {
  garantirJSON();
  fs.writeFileSync(productsPath, JSON.stringify(data, null, 2));
}

function formatar(v) {
  return v.toFixed(2).replace(".", ",");
}

/* ================= MERCADO PAGO ================= */

const mpClient = new MercadoPagoConfig({
  accessToken: config.mpToken
});
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
    .setDescription("Criar painel da loja")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

client.once("ready", async () => {
  console.log("✅ Online");
  await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
});

/* ================= INTERAÇÕES ================= */

client.on("interactionCreate", async interaction => {

  try {

    /* ===== CRIAR PRODUTO ===== */

    if (interaction.isChatInputCommand()) {

      await interaction.deferReply({ ephemeral: true });

      if (interaction.commandName === "criar-produto") {

        if (!interaction.member.roles.cache.has(config.adminRoleId))
          return interaction.editReply({ content: "❌ Sem permissão." });

        const data = getProducts();

        const produto = {
          id: Date.now().toString(),
          nome: interaction.options.getString("nome"),
          descricao: interaction.options.getString("descricao"),
          preco: interaction.options.getNumber("preco"),
          estoque: interaction.options.getInteger("estoque"),
          link: interaction.options.getString("link")
        };

        data.products.push(produto);
        saveProducts(data);

        return interaction.editReply({ content: "✅ Produto criado!" });
      }

      /* ===== PAINEL ===== */

      if (interaction.commandName === "painel") {

        const data = getProducts();
        if (data.products.length === 0)
          return interaction.editReply({ content: "❌ Sem produtos." });

        for (const p of data.products) {

          const embed = new EmbedBuilder()
            .setTitle(`🛍 ${p.nome}`)
            .setDescription(
              `${p.descricao}\n\n━━━━━━━━━━━━━━━━━━\n` +
              `💰 **Valor:** R$ ${formatar(p.preco)}\n` +
              `📦 **Estoque:** ${p.estoque}\n` +
              `━━━━━━━━━━━━━━━━━━`
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
    }

    /* ===== BOTÃO COMPRAR ===== */

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
        parent: config.ticketCategoryId || null,
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
          `📦 **Produto:** ${produto.nome}\n\n` +
          `💰 **Preço unitário:** R$ ${formatar(produto.preco)}\n\n` +
          `✏️ Clique em **Inserir Quantidade** para continuar.\n`
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

    /* ===== MODAL QUANTIDADE ===== */

    if (interaction.isButton() && interaction.customId === "inserir_qtd") {

      const modal = new ModalBuilder()
        .setCustomId("modal_qtd")
        .setTitle("Digite a quantidade");

      const input = new TextInputBuilder()
        .setCustomId("quantidade_input")
        .setLabel("Escreva a quantidade de produtos")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));

      return interaction.showModal(modal);
    }

    /* ===== RECEBER QUANTIDADE ===== */

    if (interaction.isModalSubmit() && interaction.customId === "modal_qtd") {

      await interaction.deferReply();

      const qtd = parseInt(interaction.fields.getTextInputValue("quantidade_input"));

      if (isNaN(qtd) || qtd <= 0)
        return interaction.editReply({ content: "❌ Quantidade inválida." });

      const carrinho = carrinhos[interaction.channel.id];
      const data = getProducts();
      const produto = data.products.find(p => p.id === carrinho.produtoId);

      if (qtd > produto.estoque)
        return interaction.editReply({ content: "❌ Estoque insuficiente." });

      const total = produto.preco * qtd;

      const pagamento = await paymentClient.create({
        body: {
          transaction_amount: total,
          description: produto.nome,
          payment_method_id: "pix",
          payer: { email: "cliente@email.com" }
        }
      });

      const qrBase64 = pagamento.point_of_interaction.transaction_data.qr_code_base64;
      const qrBuffer = Buffer.from(qrBase64, "base64");
      const attachment = new AttachmentBuilder(qrBuffer, { name: "qrcode.png" });

      const embed = new EmbedBuilder()
        .setTitle("💳 PAGAMENTO VIA PIX")
        .setDescription(
          `💰 Valor total: R$ ${formatar(total)}\n\n` +
          `🟢 PASSO A PASSO\n\n` +
          `🟢 Abra seu banco\n` +
          `🟢 Vá em Pix\n` +
          `🟢 Escaneie o QR Code\n` +
          `🟢 Confirme o pagamento\n\n` +
          `📋 Código copia e cola:\n\n` +
          `\`\`\`\n${pagamento.point_of_interaction.transaction_data.qr_code}\n\`\`\``
        )
        .setImage("attachment://qrcode.png")
        .setColor("#00ff88");

      return interaction.editReply({
        embeds: [embed],
        files: [attachment]
      });
    }

    /* ===== FECHAR TICKET ===== */

    if (interaction.isButton() && interaction.customId === "fechar_ticket") {
      await interaction.channel.delete();
    }

  } catch (err) {
    console.error("ERRO:", err);
    if (!interaction.replied)
      interaction.reply({ content: "❌ Erro interno.", ephemeral: true });
  }
});

/* ================= WEB SERVER ================= */

const app = express();
app.use(bodyParser.json());
app.post("/webhook", (req, res) => res.sendStatus(200));
app.listen(3000);

client.login(config.token);