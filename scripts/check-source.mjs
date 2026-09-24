import {readdir,readFile} from "node:fs/promises";
import {extname,join} from "node:path";

const roots=["app","lib"];
const extensions=new Set([".ts",".tsx",".js",".jsx"]);
const suspicious=/\\n\s+(?:function|const|let|if|for|while|useEffect|return|export|import)\b/g;
const failures=[];

async function walk(dir){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);
    if(entry.isDirectory())await walk(path);
    else if(extensions.has(extname(entry.name))){
      const source=await readFile(path,"utf8");
      let match;
      while((match=suspicious.exec(source))){
        const line=source.slice(0,match.index).split("\n").length;
        failures.push(path+":"+line+" contains a literal \\n before source code");
      }
    }
  }
}
for(const root of roots)await walk(root);
if(failures.length){
  console.error("Source guard failed:");
  for(const failure of failures)console.error(" - "+failure);
  process.exit(1);
}
console.log("Source guard passed");
