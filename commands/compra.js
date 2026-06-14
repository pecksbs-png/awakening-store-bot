import {
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
import { MercadoPagoConfig, Payment } from "mercadopago";

const productsPath = "./data/products.json";

const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_TOKEN
});

const paymentClient = new Payment(mpClient);

let carrinhos = {};
let pagamentos = {};

/* ===== JSON ===== */

function getProducts() {
  if (!fs.existsSync(productsPath))
    fs.writeFileSync(productsPath, JSON.stringify({ products: [] }, null, 2));
  return JSON.parse(fs.readFileSync(productsPath));
}

function formatar(v) {
  return Number(v || 0).toFixed(2).replace(".", ",");
}

/* ===== EXPORT ===== */

export default {

  data: new SlashCommandBuilder()
    .setName("compra-status")
    .setDescription("Verificar status do sistema de compra"),

  async execute(interaction) {

    await interaction.reply({
      content: "✅ Sistema de compra ativo.",
      ephemeral: true
    });
  },

  /* ===== BOTÃO COMPRAR ===== */

  async button(interaction) {

    /* === Botão Comprar === */
    if (interaction.customId.startsWith("buy_")) {

      await interaction.deferReply({ ephemeral: true });

      const id = interaction.customId.replace("buy_", "");
      const produto = getProducts().products.find(p => p.id === id);

      if (!produto)
        return interaction.editReply({ content: "❌ Produto não encontrado." });

      const canal = await interaction.guild.channels.create({
        name: `compra-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: process.env.TICKET_CATEGORY_ID,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          {
            id: interaction.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages
            ]
          }
        ]
      });

      carrinhos[canal.id] = {
        produtoId: produto.id,
        userId: interaction.user.id
      };

      const embed = new EmbedBuilder()
        .setTitle("🛒 FINALIZAR COMPRA")
        .setDescription(
          `📦 Produto: **${produto.nome}**\n` +
          `💰 Valor unitário: R$ ${formatar(produto.preco)}\n\n` +
          `✏️ Clique abaixo para inserir a quantidade.`
        )
        .setColor("#9b00ff");

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

    /* === Inserir Quantidade === */
    if (interaction.customId === "inserir_qtd") {

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

    /* === Fechar Ticket === */
    if (interaction.customId === "fechar_ticket") {
      await interaction.channel.delete().catch(() => {});
    }
  },

  /* ===== MODAL QUANTIDADE ===== */

  async modal(interaction) {

    if (interaction.customId !== "modal_qtd") return;

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
      total
    };

    const qrBase64 = pagamento.point_of_interaction.transaction_data.qr_code_base64;
    const qrBuffer = Buffer.from(qrBase64, "base64");
    const attachment = new AttachmentBuilder(qrBuffer, { name: "qrcode.png" });

    const embed = new EmbedBuilder()
      .setTitle("💳 PAGAMENTO VIA PIX")
      .setDescription(
        `💰 Valor total: **R$ ${formatar(total)}**\n\n` +
        `🟢 Abra seu banco\n` +
        `🟢 Escaneie o QR Code ou Use o Codigo Copia e Cola\n` +
        `🟢 Confirme o pagamento\n\n` +
        `📋 Código copia e cola:\n\n\`\`\`\n${pagamento.point_of_interaction.transaction_data.qr_code}\n\`\`\``
      )
      .setImage("attachment://qrcode.png")
      .setColor("#9b00ff");

    return interaction.editReply({
      embeds: [embed],
      files: [attachment]
    });
  }
};

/* ===== EXPORT PAGAMENTOS PARA WEBHOOK ===== */

export { pagamentos };