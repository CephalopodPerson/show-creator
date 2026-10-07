const { app } = require('./app');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Show Creator running at http://localhost:${PORT}`));
