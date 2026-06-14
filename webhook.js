import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { pagamentos } from "./commands/compra.js";

const productsPath = "./data/products.json";
const statsPath = "./data/stats.json";

function getProducts() {
  return JSON.parse(fs.readFileSync(productsPath));
}

function saveProducts(data) {
  fs.writeFileSync(productsPath, JSON.stringify(data, null, 2));
}

function getStats() {
  if (!fs.existsSync(statsPath))
    fs.writeFileSync(statsPath, JSON.stringify({ sales: [] }, null, 2));
  return JSON.parse(fs.readFileSync(statsPath));
}

function saveStats(data) {
  fs.writeFileSync(statsPath, JSON.stringify(data, null, 2));
}

const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_TOKEN
});

const paymentClient = new Payment(mpClient);

const app = express();
app.use(bodyParser.json());

export default function startWebhook(client) {

  app.post("/webhook", async (req, res) => {

    try {

      const paymentId = req.body?.data?.id;
      if (!paymentId) return res.sendStatus(200);

      const pagamentoInfo = await paymentClient.get({ id: paymentId });

      if (pagamentoInfo.status === "approved") {

        const info = pagamentos[paymentId];
        if (!info) return res.sendStatus(200);

        const data = getProducts();
        const produto = data.products.find(p => p.id === info.produtoId);

   if (produto.estoque !== "INF") {
  produto.estoque -= info.quantidade;
}
        saveProducts(data);

        const stats = getStats();
        stats.sales.push({
          user: info.userId,
          total: info.total
        });
        saveStats(stats);

        const user = await client.users.fetch(info.userId);
        await user.send(
  `✅ Pagamento aprovado!\n\n📦 Sua entrega:\n\n\`\`\`\n${produto.entrega || produto.link || "Entrega indisponível"}\n\`\`\``
);

        const canal = await client.channels.fetch(info.canalId);
        await canal.send("✅ Pagamento confirmado! Ticket será fechado em 10s.");
        setTimeout(() => canal.delete().catch(() => {}), 10000);

        if (process.env.LOG_CHANNEL_ID) {
          const log = await client.channels.fetch(process.env.LOG_CHANNEL_ID);
          await log.send(`💰 Venda confirmada: ${produto.nome} x${info.quantidade}`);
        }

        delete pagamentos[paymentId];
      }

      res.sendStatus(200);

    } catch (err) {
      console.error("ERRO WEBHOOK:", err);
      res.sendStatus(500);
    }
  });

  app.listen(3000, () => {
    console.log("🌐 Webhook rodando na porta 3000");
  });
}