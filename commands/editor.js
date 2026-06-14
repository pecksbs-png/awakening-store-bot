import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";

import fs from "fs";

const productsPath = "./data/products.json";

let editorState = {};

/* ===== FUNÇÕES JSON ===== */

function getProducts() {
  if (!fs.existsSync(productsPath))
    fs.writeFileSync(productsPath, JSON.stringify({ products: [] }, null, 2));
  return JSON.parse(fs.readFileSync(productsPath));
}

function saveProducts(data) {
  fs.writeFileSync(productsPath, JSON.stringify(data, null, 2));
}

function formatar(v) {
  return Number(v || 0).toFixed(2).replace(".", ",");
}

/* ===== EMBED ===== */

function gerarEmbed(userId) {

  const p = editorState[userId];

  return new EmbedBuilder()
    .setTitle(`🛍 ${p.nome.toUpperCase()}`)
    .setDescription(
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📦 **DESCRIÇÃO:**\n${p.descricao}\n\n` +
      `💰 **VALOR:** R$ ${formatar(p.preco)}\n` +
      `📦 **ESTOQUE:** ${p.estoque === "INF" ? "♾ Infinito" : p.estoque}\n` +
      `🔗 **📦 ENTREGA:\n${p.entrega}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`
    )
    .setColor("#9b00ff")
    .setFooter({ text: "Awakening Store • Editor de Produto" })
    .setTimestamp();
}

/* ===== BOTÕES ===== */

function gerarBotoes() {

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("editar_nome").setLabel("✏️ Nome").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("editar_descricao").setLabel("📝 Descrição").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("editar_preco").setLabel("💰 Preço").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("editar_estoque").setLabel("📦 Estoque").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("editar_entrega").setLabel("📦 Entrega").setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("salvar").setLabel("✅ Salvar").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("cancelar").setLabel("❌ Cancelar").setStyle(ButtonStyle.Danger)
  );

  return [row1, row2];
}

/* ===== EXPORT ===== */

export default {

  data: new SlashCommandBuilder()
    .setName("editor")
    .setDescription("Abrir editor visual de produto"),

  async execute(interaction) {

    await interaction.deferReply({ ephemeral: true });

    editorState[interaction.user.id] = {
      nome: "Novo Produto",
      descricao: "Descrição do produto...",
      preco: 0,
      estoque: 0,
      entrega: "Conteúdo da entrega..."
    };

    return interaction.editReply({
      embeds: [gerarEmbed(interaction.user.id)],
      components: gerarBotoes()
    });
  },

  async button(interaction) {

    const userId = interaction.user.id;

    if (!editorState[userId]) return;

    if (interaction.customId === "salvar") {

      const data = getProducts();
      data.products.push({
        id: Date.now().toString(),
        ...editorState[userId]
      });

      saveProducts(data);
      delete editorState[userId];

      return interaction.update({
        content: "✅ Produto salvo!",
        embeds: [],
        components: []
      });
    }

    if (interaction.customId === "cancelar") {
      delete editorState[userId];
      return interaction.update({
        content: "❌ Produto cancelado.",
        embeds: [],
        components: []
      });
    }

    if (interaction.customId.startsWith("editar_")) {

      const campo = interaction.customId.replace("editar_", "");

      const modal = new ModalBuilder()
        .setCustomId(`modal_${campo}`)
        .setTitle("Editar Produto");

      const input = new TextInputBuilder()
        .setCustomId("valor_input")
        .setLabel(`Novo ${campo}`)
        .setStyle(
          campo === "descricao"
            ? TextInputStyle.Paragraph
            : TextInputStyle.Short
        )
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));

      return interaction.showModal(modal);
    }
  },

  async modal(interaction) {

    const userId = interaction.user.id;

    if (!editorState[userId]) return;

    if (interaction.customId.startsWith("modal_")) {

      const campo = interaction.customId.replace("modal_", "");
      const valor = interaction.fields.getTextInputValue("valor_input");

      if (campo === "preco") {
  editorState[userId][campo] = Number(valor);
} 
else if (campo === "estoque") {
  editorState[userId][campo] = valor.toUpperCase() === "INF"
    ? "INF"
    : Number(valor);
} 
else {
  editorState[userId][campo] = valor;
}

      return interaction.reply({
        embeds: [gerarEmbed(userId)],
        components: gerarBotoes(),
        ephemeral: true
      });
    }
  }
};