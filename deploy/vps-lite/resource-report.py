#!/usr/bin/env python3
"""Read-only numerical snapshot. No environment, content, request IDs or credentials."""
import json,pathlib,subprocess,datetime

def snapshot():
 result={'atUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'readOnly':True}
 for unit in ['yaoyao-api','yaoyao.slice']:
  try:
   raw=subprocess.check_output(['systemctl','show',unit,'-p','ActiveState','-p','NRestarts','-p','MemoryCurrent','-p','MemoryPeak','-p','MemoryMax'],text=True,stderr=subprocess.DEVNULL,timeout=5)
   result[unit]=dict(line.split('=',1)for line in raw.splitlines()if '='in line)
  except (OSError,subprocess.SubprocessError):result[unit]={'available':False}
 try:
  result['memoryEvents']={k:int(v)for k,v in (l.split()for l in pathlib.Path('/sys/fs/cgroup/yaoyao.slice/memory.events').read_text().splitlines())}
 except (OSError,ValueError):result['memoryEvents']={'available':False}
 return result
if __name__=='__main__':print(json.dumps(snapshot()))
