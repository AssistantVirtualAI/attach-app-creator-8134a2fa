import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const files=[
  'infra/lemtel-resilience/do-writer-resource-observability/lemtel-ha-do-writer-resource-publisher-activation-apply.sh',
  'infra/lemtel-resilience/do-writer-resource-observability/lemtel-do-writer-resource-publish.sh',
  'infra/lemtel-resilience/do-writer-resource-observability/publisher-activation-manifest.json',
  'infra/lemtel-resilience/do-writer-resource-observability/systemd/lemtel-do-writer-resource-publisher.service',
  'infra/lemtel-resilience/do-writer-resource-observability/systemd/lemtel-do-writer-resource-publisher.timer',
];
const fail=(reason)=>{ throw new Error(`package_${reason}`); };
const sha=(path)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const argument=(name)=>{ const index=process.argv.indexOf(name); if(index<0||!process.argv[index+1]) fail('arguments_invalid'); return process.argv[index+1]; };
export function assembleDoWriterResourcePublisherActivationPackage({sourceRevision,output}) {
  if(!/^[a-f0-9]{40}$/u.test(sourceRevision)) fail('source_revision_invalid');
  if(!output.endsWith('.tar')||existsSync(output)) fail('output_invalid');
  const stage=mkdtempSync(join(tmpdir(),'lemtel-resource-publisher-package-'));
  try {
    const checksums=[];
    for(const item of files){ const source=resolve(root,item); if(!existsSync(source)) fail('source_missing'); const target=join(stage,item); const made=spawnSync('/usr/bin/mkdir',['-p',dirname(target)],{encoding:'utf8'}); if(made.status!==0||made.stderr) fail('mkdir_failed'); copyFileSync(source,target); checksums.push(`${sha(source)}  ${item}`); }
    const metadata={package_format:'lemtel_do_writer_resource_publisher_activation_package_v1',source_revision:sourceRevision,target_role:'digitalocean_writer',snapshot_attestation_required:true,publisher_configuration_written:false,publisher_installed:false,publisher_timer_enabled:false,hostinger_contacted:false,cloudflare_or_dns_changed:false,promotion_executed:false,fencing_executed:false,automatic_failover_enabled:false,telephony_contacted:false,credential_values_emitted:false};
    writeFileSync(join(stage,'deployment-metadata.json'),`${JSON.stringify(metadata,null,2)}\n`,{mode:0o600});
    checksums.push(`${sha(join(stage,'deployment-metadata.json'))}  deployment-metadata.json`);
    writeFileSync(join(stage,'manifest.sha256'),`${checksums.sort().join('\n')}\n`,{mode:0o600});
    const entries=[...files,'deployment-metadata.json','manifest.sha256'].sort();
    const result=spawnSync('/usr/bin/tar',['--format=ustar','--sort=name','--mtime=@0','--owner=0','--group=0','--numeric-owner','--mode=u=rw,go=','-cf',output,'-C',stage,...entries],{encoding:'utf8'});
    if(result.status!==0||result.stderr) fail('tar_failed');
    writeFileSync(`${output}.sha256`,`${sha(output)}  ${basename(output)}\n`,{mode:0o600});
  } finally { rmSync(stage,{recursive:true,force:true}); }
}
if(import.meta.main){ try { if(process.argv.length!==6||process.argv[2]!=='--source-revision'||process.argv[4]!=='--output') fail('arguments_invalid'); assembleDoWriterResourcePublisherActivationPackage({sourceRevision:argument('--source-revision'),output:argument('--output')}); console.log(JSON.stringify({package_status:'created',deployment_executed:false,publisher_installed:false,publisher_timer_enabled:false,hostinger_contacted:false,automatic_failover_enabled:false})); } catch(error){ console.error(JSON.stringify({package_status:'failed',reason:'package_refused'})); process.exitCode=1; } }
