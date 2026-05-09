const http = require('http');

http.get('http://127.0.0.1:5050/api/v1/mqtt-servers', {
  headers: {
    // We don't have the real token, but let's see if we can read it from .env or just bypass.
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Response:', res.statusCode);
    console.log(data);
  });
}).on('error', err => {
  console.log('Error:', err.message);
});
