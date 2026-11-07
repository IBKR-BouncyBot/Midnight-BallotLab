import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { validateBrowserModuleAssets, verifyBrowserModuleAssets } from '../../scripts/browser-module-assets.mjs';
const bytes=Buffer.from('export const publicFixture = true;\n');
const record={path:'network-chunk-ABCDEFG2.mjs',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
test('module records reject traversal, duplicate paths, unknown fields and invalid sizes',()=>{
 for(const records of [[],[{...record,path:'../network-chunk-ABCDEFG2.mjs'}],[record,record],[{...record,private:'not-allowed'}],[{...record,bytes:0}],[{...record,sha256:'A'.repeat(64)}]]) assert.throws(()=>validateBrowserModuleAssets(records));
 assert.throws(()=>validateBrowserModuleAssets([record],'unexpected'));
});
test('module validation binds exact served bytes and detects changed or missing chunks',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'ballot-module-integrity-'));
 try{
  await writeFile(join(folder,record.path),bytes);
  assert.deepEqual(await verifyBrowserModuleAssets(folder,[record]),[record]);
  await writeFile(join(folder,record.path),Buffer.from('changed'));
  await assert.rejects(verifyBrowserModuleAssets(folder,[record]));
  await assert.rejects(verifyBrowserModuleAssets(folder,[{...record,path:'network-chunk-HIJKLMN3.mjs'}]));
 }finally{assert.equal(dirname(folder),resolve(tmpdir()));await rm(folder,{recursive:true,force:true});}
});
