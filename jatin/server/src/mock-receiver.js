const express = require('express');
const app = express();

app.use(express.json());

app.post('/mock-endpoint', (req, res) => {
  console.log('\n[MOCK RECEIVER] Outgoing Webhook Event Logged');
  console.log(`Source event: ${req.body.source}`);
  console.log(`Recipient:    ${req.body.recipient}`);
  console.log('Payload Data:');
  console.log(JSON.stringify(req.body.data, null, 2));
  console.log('=============================================\n');
  res.status(200).send('OK');
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`\nMock Webhook Receiver active on http://localhost:${PORT}/mock-endpoint`);
});
