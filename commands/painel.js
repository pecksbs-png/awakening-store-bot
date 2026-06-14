import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";

import fs from "fs";

const productsPath = "./data/products.json";

/* ===== JSON ===== */

function getProducts() {
  if (!fs.existsSync(productsPath))
    fs.writeFileSync(productsPath, JSON.stringify({ products: [] }, null, 2));
  return JSON.parse(fs.readFileSync(productsPath));
}

function formatar(v) {
  return Number(v || 0).toFixed(2).replace(".", ",");
}

/* ===== EMBED PREMIUM ===== */

function gerarEmbedProduto(p) {

  let alertaEstoque = "";
  if (p.estoque <= 5 && p.estoque > 0)
    alertaEstoque = "\n⚠️ **ÚLTIMAS UNIDADES DISPONÍVEIS!**";
  if (p.estoque === 0)
    alertaEstoque = "\n❌ **PRODUTO ESGOTADO**";

  return new EmbedBuilder()
    .setTitle(`🛍 ${p.nome.toUpperCase()}`)
    .setDescription(
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `✨ **PRODUTO PREMIUM**\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📦 **DESCRIÇÃO:**\n${p.descricao}\n\n` +
      `💰 **VALOR:** R$ ${formatar(p.preco)}\n` +
      `📦 ESTOQUE: ${p.estoque === "INF" ? "♾ Infinito" : p.estoque}` +
      `${alertaEstoque}\n\n` +
      `⭐ **AVALIAÇÃO:** ⭐⭐⭐⭐⭐\n` +
      `🚀 Entrega automática\n` +
      `🔒 Compra 100% segura\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`
    )
    .setColor("#9b00ff")
    .setFooter({ text: "Awakening Store • Loja Premium" })
    .setTimestamp();
}

/* ===== EXPORT ===== */

export default {

  data: new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Criar painel da loja"),

  async execute(interaction) {

    await interaction.deferReply({ ephemeral: true });

    const data = getProducts();

    if (!data.products.length)
      return interaction.editReply({ content: "❌ Nenhum produto cadastrado." });

    for (const p of data.products) {

      const embed = gerarEmbedProduto(p);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`buy_${p.id}`)
          .setLabel("🛒 Comprar")
          .setStyle(ButtonStyle.Success)
         .setDisabled(p.estoque !== "INF" && p.estoque <= 0)
      );

      await interaction.channel.send({
        embeds: [embed],
        components: [row]
      });
    }

    return interaction.editReply({ content: "✅ Painel criado!" });
  }
};