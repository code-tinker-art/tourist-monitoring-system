const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 2000;

const server = http.createServer((req, res) => {
    console.log(`Request for: ${req.url}`);

    // Serve index.html for root request
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    let ext = path.extname(filePath);

    // Only handle HTML, JS, CSS
    let contentType = 'text/html';
    if (ext === '.js') contentType = 'application/javascript';
    if (ext === '.css') contentType = 'text/css';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('404 Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
