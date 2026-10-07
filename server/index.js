const { app, assignMissingCodes } = require('./app');

const PORT = process.env.PORT || 3000;
assignMissingCodes();
app.listen(PORT, () => console.log(`Show Creator running at http://localhost:${PORT}`));
