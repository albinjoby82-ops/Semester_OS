import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const PORT = Number(process.env.SEMESTER_BRIDGE_PORT || 4317);
const VAULT = path.resolve(process.env.SEMESTER_VAULT || path.join(process.cwd(), "Semester Vault"));
const TYPES = new Set(["slides","lab","lab-report","worksheet","assignment","assignment-report","past-paper","formula-sheet","notes","other"]);
const safe = p => { const full = path.resolve(VAULT, p || "."); if (full !== VAULT && !full.startsWith(VAULT + path.sep)) throw new Error("Path is outside the configured vault"); return full; };
const json = (res, status, body) => { res.writeHead(status, {"content-type":"application/json","access-control-allow-origin":"*"}); res.end(JSON.stringify(body)); };
async function walk(dir, out = []) { for (const e of await fs.readdir(dir, {withFileTypes:true}).catch(() => [])) { const p=path.join(dir,e.name); if(e.isDirectory() && e.name !== ".semester-os") await walk(p,out); else if(e.isFile() && /\.pdf$/i.test(e.name)) out.push(p); } return out; }
function infer(abs) { const rel=path.relative(VAULT,abs); const parts=rel.split(path.sep); const module=parts[0] || "Uncategorised"; const raw=(parts[1]||"other").toLowerCase(); const aliases={slides:"slides",labs:"lab",worksheets:"worksheet",assignments:"assignment","past papers":"past-paper",notes:"notes"}; return {module,type:aliases[raw] || (TYPES.has(raw)?raw:"other")}; }
async function resources() { const files=await walk(VAULT); return Promise.all(files.map(async abs => { const st=await fs.stat(abs); const buf=await fs.readFile(abs); const {module,type}=infer(abs); let pages; try { const r=await exec("pdfinfo",[abs]); pages=Number(/Pages:\s+(\d+)/.exec(r.stdout)?.[1])||undefined; } catch {} return {id:crypto.createHash("sha256").update(buf).digest("hex"),path:path.relative(VAULT,abs),title:path.basename(abs,".pdf"),module,type,pages,modifiedAt:st.mtime.toISOString(),status:"discovered"}; })); }
const server=http.createServer(async (req,res)=>{ try { const u=new URL(req.url,`http://127.0.0.1:${PORT}`); if(req.method==="OPTIONS"){res.writeHead(204,{"access-control-allow-origin":"*","access-control-allow-methods":"GET,POST","access-control-allow-headers":"content-type"});return res.end();} if(u.pathname==="/api/health") return json(res,200,{ok:true,vault:VAULT}); if(u.pathname==="/api/resources") return json(res,200,await resources()); if(u.pathname==="/api/file"){ const abs=safe(u.searchParams.get("path")); const st=await fs.stat(abs); res.writeHead(200,{"content-type":"application/pdf","content-length":st.size,"access-control-allow-origin":"*"}); return (await import("node:fs")).createReadStream(abs).pipe(res); } return json(res,404,{error:"Not found"}); } catch(e){ return json(res,400,{error:e.message}); }});
await fs.mkdir(VAULT,{recursive:true}); server.listen(PORT,"127.0.0.1",()=>console.log(`Semester OS bridge listening on http://127.0.0.1:${PORT}\nVault: ${VAULT}`));
