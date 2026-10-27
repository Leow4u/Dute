import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packages = ['operacao','wms','comercial','financeiro','rh','core'];
const selected = process.argv[2] ? [process.argv[2]] : packages;
if (selected.some(name=>!packages.includes(name))) throw new Error('Codebase desconhecida.');
const source = join(root,'functions/api-shared');
const files = (await readdir(source)).filter(file=>file.endsWith('.ts'));
const manifests=[];
for(const name of packages){
 try{manifests.push(...JSON.parse(await readFile(join(root,'functions',name,'src/api/routes.json'),'utf8')))}
 catch(error){if(error.code!=='ENOENT')throw error;}
}
for(const name of selected){
 const target=join(root,'functions',name,'src/api/shared');await mkdir(target,{recursive:true});
 for(const file of files)await copyFile(join(source,file),join(target,file));
 await writeFile(join(target,'manifests.ts'),'// Gerado por tools/sync_api_shared.mjs\nexport const PLATFORM_ROUTES: Array<Record<string, any>> = '+JSON.stringify(manifests,null,2)+';\n');
}
