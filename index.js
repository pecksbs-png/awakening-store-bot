import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
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
const products = JSON.parse(fs.readFileSync("./products.json"));

/* ================= MERCADO PAGO ================= */

const mpClient = new MercadoPagoConfig({
  accessToken: config.mercadoPagoToken
});

const paymentClient = new Payment(mpClient);

/* ================= DISCORD ================= */

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let pagamentos = {};

/* ================= REGISTRAR COMANDOS ================= */

const commands = [
  new SlashCommandBuilder()
    .setName("loja")
    .setDescription("Ver produtos disponíveis"),

  new SlashCommandBuilder()
    .setName("comprar")
    .setDescription("Comprar um produto")
    .addStringOption(option =>
      option.setName("id")
        .setDescription("ID do produto")
        .setRequired(true))
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

client.once("ready", async () => {
  console.log(`✅ Awakening Store online como ${client.user.tag}`);

  await rest.put(
    Routes.applicationCommands(config.clientId),
    { body: commands }
  );

  console.log("✅ Comandos registrados.");
});

/* ================= COMANDOS ================= */

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "loja") {

    let mensagem = "🛒 **Awakening Store**\n\n";

    products.forEach(prod => {
      mensagem += `📦 **${prod.nome}**\n💰 R$${prod.preco}\n📦 Estoque: ${prod.estoque}\n🆔 ID: ${prod.id}\n\n`;
    });

    await interaction.reply({ content: mensagem });
  }

  if (interaction.commandName === "comprar") {

    const id = interaction.options.getString("id");
    const produto = products.find(p => p.id === id);

    if (!produto)
      return interaction.reply({ content: "❌ Produto não encontrado.", ephemeral: true });

    if (produto.estoque <= 0)
      return interaction.reply({ content: "❌ Produto sem estoque.", ephemeral: true });

    const pagamento = await paymentClient.create({
      body: {
        transaction_amount: produto.preco,
        description: produto.nome,
        payment_method_id: "pix",
        payer: {
          email: "cliente@email.com"
        }
      }
    });

    pagamentos[pagamento.id] = {
      userId: interaction.user.id,
      produtoId: produto.id
    };

    const qrCode = pagamento.point_of_interaction.transaction_data.qr_code;

    await interaction.reply({
      content: `💳 Pague via Pix:\n\`\`\`\n${qrCode}\n\`\`\`\n✅ Após o pagamento o produto será entregue automaticamente.`,
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

    const produto = products.find(p => p.id === info.produtoId);

    produto.estoque -= 1;
    fs.writeFileSync("./products.json", JSON.stringify(products, null, 2));

    const user = await client.users.fetch(info.userId);
    await user.send(`✅ Pagamento aprovado!\nAqui está seu produto:\n${produto.link}`);

    const logChannel = await client.channels.fetch(config.logChannelId);
    await logChannel.send(`💰 Nova venda!\n📦 Produto: ${produto.nome}\n👤 Cliente: <@${info.userId}>`);

    delete pagamentos[paymentId];
  }

  res.sendStatus(200);
});

app.listen(3000, () => {
  console.log("🌐 Webhook rodando na porta 3000");
});

client.login(config.token);