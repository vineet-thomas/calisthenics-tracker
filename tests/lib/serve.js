// Minimal static file server for tests (no caching headers, like python -m http.server).
const http = require("http"), fs = require("fs"), path = require("path");
const TYPES = { ".html":"text/html; charset=utf-8", ".js":"application/javascript", ".json":"application/json",
  ".webmanifest":"application/manifest+json", ".png":"image/png", ".md":"text/markdown" };
function serve(dir, port){
  return new Promise(resolve=>{
    const server = http.createServer((req, res)=>{
      let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if(rel.endsWith("/")) rel += "index.html";
      const file = path.join(dir, rel);
      if(!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    }).listen(port, ()=>resolve(server));
  });
}
module.exports = { serve };
