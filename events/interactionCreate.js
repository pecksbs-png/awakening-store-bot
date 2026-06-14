export default {
  name: "interactionCreate",

  async execute(interaction, client) {

    try {

      /* ===== COMANDOS ===== */

      if (interaction.isChatInputCommand()) {

        const command = client.commands.get(interaction.commandName);

        if (!command) {
          return interaction.reply({
            content: "❌ Comando não encontrado.",
            ephemeral: true
          });
        }

        await command.execute(interaction, client);
      }

      /* ===== BOTÕES ===== */

      if (interaction.isButton()) {

        for (const [, cmd] of client.commands) {
          if (cmd.button) {
            await cmd.button(interaction, client);
          }
        }
      }

      /* ===== MODAIS ===== */

      if (interaction.isModalSubmit()) {

        for (const [, cmd] of client.commands) {
          if (cmd.modal) {
            await cmd.modal(interaction, client);
          }
        }
      }

    } catch (err) {

      console.error("❌ Erro em interactionCreate:", err);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "❌ Ocorreu um erro interno.",
          ephemeral: true
        }).catch(() => {});
      }
    }
  }
};