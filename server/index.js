const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;

createApp()
    .then(({ server, close }) => {
        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });

        let shuttingDown = false;
        const shutdown = () => {
            if (shuttingDown) return;
            shuttingDown = true;
            close().catch(console.error).finally(() => process.exit(0));
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    })
    .catch((err) => {
        console.error("Failed to start server:", err);
        process.exit(1);
    });
