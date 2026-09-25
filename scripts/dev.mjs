import {spawn} from 'node:child_process';
const args=process.argv.slice(2);const pi=args.indexOf('--port');const port=pi>=0?args[pi+1]:'3000';
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','0.0.0.0','--port',port],{stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));child.on('exit',code=>process.exit(code??0));
