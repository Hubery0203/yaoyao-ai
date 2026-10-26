#!/usr/bin/env python3
"""Forced-command ciphertext repository. Install under root control; executes no client shell text."""
import base64,datetime,fcntl,hashlib,json,os,pathlib,re,stat,sys,uuid
MAX_FILE=64*1024*1024
MAX_REPOSITORY=512*1024*1024
NAME=re.compile(r'^yaoyao-\d{8}T\d{6}Z-[a-f0-9]{16}\.yyb$')
def fail(code):raise RuntimeError(code)
def valid(name):
 if not isinstance(name,str) or not NAME.fullmatch(name):return False
 try:datetime.datetime.strptime(name[7:23],'%Y%m%dT%H%M%SZ');return True
 except ValueError:return False
def info(fd,name):
 f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
 try:
  s=os.fstat(f)
  if not stat.S_ISREG(s.st_mode) or s.st_mode&0o077 or s.st_size>MAX_FILE:fail('PRIVATE_OBJECT_REQUIRED')
  h=hashlib.sha256()
  with os.fdopen(f,'rb',closefd=False)as source:
   for block in iter(lambda:source.read(65536),b''):h.update(block)
  return {'name':name,'bytes':s.st_size,'sha256':h.hexdigest()}
 finally:os.close(f)
def run(config,request,stdin,stdout,read_only=False):
 root=pathlib.Path(config['directory']);namespace=config['namespace'];op=request.get('op');name=request.get('name','')
 if not root.is_absolute() or '..'in root.parts or not re.fullmatch('[a-f0-9]{32}',namespace) or request.get('namespace')!=namespace:fail('INVALID_REPOSITORY')
 if op not in ['init','put','get','stat','list','delete']or read_only and op in ['init','put','delete']:fail('OPERATION_NOT_ALLOWED')
 if op not in ['init','list'] and not valid(name):fail('INVALID_OBJECT_NAME')
 # No symlink path components, even if the final directory itself is real.
 for ancestor in [*reversed(root.parents),root]:
  if ancestor.exists() and ancestor.is_symlink():fail('SYMLINK_REPOSITORY')
 if op=='init' and not root.exists():root.mkdir(mode=0o700)
 fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:
  s=os.fstat(fd)
  if s.st_mode&0o077 or s.st_uid!=os.geteuid():fail('PRIVATE_REPOSITORY_REQUIRED')
  marker='.yaoyao-repository.json'
  try:
   m=os.open(marker,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
  except FileNotFoundError:
   if op!='init' or os.listdir(fd):fail('EXPLICIT_EMPTY_INIT_REQUIRED')
   m=os.open(marker,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
   with os.fdopen(m,'w')as out:json.dump({'version':1,'namespace':namespace},out);out.flush();os.fsync(out.fileno())
   m=os.open(marker,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
  with os.fdopen(m,'r')as source:
   ms=os.fstat(source.fileno())
   if not stat.S_ISREG(ms.st_mode) or ms.st_size>4096 or ms.st_mode&0o077:fail('INVALID_REPOSITORY_MARKER')
   if json.load(source)!={'version':1,'namespace':namespace}:fail('REPOSITORY_NAMESPACE_MISMATCH')
  lock=os.open('.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600,dir_fd=fd)
  try:
   fcntl.flock(lock,fcntl.LOCK_EX)
   names=[n for n in os.listdir(fd)if valid(n)]
   if len(names)>1000:fail('REPOSITORY_LIMIT')
   if op=='init':result={'initialized':True}
   elif op=='list':
    result=[]
    for n in names:
     v=os.stat(n,dir_fd=fd,follow_symlinks=False)
     if not stat.S_ISREG(v.st_mode)or v.st_mode&0o077:fail('PRIVATE_OBJECT_REQUIRED')
     result.append({'name':n,'bytes':v.st_size})
   elif op=='stat':result=info(fd,name)
   elif op=='get':
    v=info(fd,name);source=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
    try:
     with os.fdopen(source,'rb',closefd=False)as data:
      for block in iter(lambda:data.read(65536),b''):stdout.write(block)
     stdout.flush();return
    finally:os.close(source)
   elif op=='put':
    size=request.get('bytes');sha=request.get('sha256','')
    if not isinstance(size,int)or isinstance(size,bool)or size<36 or size>MAX_FILE or not re.fullmatch('[a-f0-9]{64}',sha)or not name.endswith(sha[:16]+'.yyb'):fail('INVALID_UPLOAD')
    total=0
    # Count abandoned uploads too; never silently delete an unknown partial file.
    for n in os.listdir(fd):
     if not (valid(n) or n.startswith('.upload-')):continue
     v=os.stat(n,dir_fd=fd,follow_symlinks=False)
     if not stat.S_ISREG(v.st_mode):fail('PRIVATE_OBJECT_REQUIRED')
     total+=v.st_size
    if total+size>MAX_REPOSITORY:fail('REPOSITORY_CAPACITY')
    temp='.upload-'+uuid.uuid4().hex+'.tmp';out=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
    try:
     h=hashlib.sha256();seen=0;header=b''
     with os.fdopen(out,'wb')as dest:
      while True:
       block=stdin.read(65536)
       if not block:break
       seen+=len(block)
       if seen>size:fail('UPLOAD_TOO_LARGE')
       if len(header)<8:header=(header+block)[:8]
       h.update(block);dest.write(block)
      dest.flush();os.fsync(dest.fileno())
     if seen!=size or h.hexdigest()!=sha or header!=b'YAOYAO1\n':fail('UPLOAD_HASH_MISMATCH')
     try:os.link(temp,name,src_dir_fd=fd,dst_dir_fd=fd,follow_symlinks=False)
     except FileExistsError:
      existing=info(fd,name)
      if existing['sha256']!=sha or existing['bytes']!=size:fail('OBJECT_ALREADY_EXISTS')
     os.fsync(fd);result={'stored':True,'sha256':sha,'bytes':size}
    finally:
     try:os.unlink(temp,dir_fd=fd)
     except FileNotFoundError:pass
   else:
    # Receiver independently keeps two newest committed objects; client additionally requires verification.
    if name in sorted(names,reverse=True)[:2]:fail('KEEP_AT_LEAST_TWO')
    before=info(fd,name)
    if before['sha256']!=request.get('sha256'):fail('DELETE_HASH_MISMATCH')
    os.unlink(name,dir_fd=fd);os.fsync(fd);result={'deleted':True}
   stdout.write((json.dumps(result)+'\n').encode());stdout.flush()
  finally:os.close(lock)
 finally:os.close(fd)
def main():
 try:
  config_path='/etc/yaoyao-backup-receiver.json'
  with open(config_path,'r')as f:config=json.load(f)
  command=os.environ.get('SSH_ORIGINAL_COMMAND','')
  if not command.startswith('yaoyao-backup-v1 ') or len(command)>4096:fail('INVALID_COMMAND')
  encoded=command.split(' ',1)[1]
  if not re.fullmatch('[A-Za-z0-9_-]+',encoded):fail('INVALID_COMMAND')
  request=json.loads(base64.urlsafe_b64decode(encoded+'='*((-len(encoded))%4)))
  if not isinstance(request,dict):fail('INVALID_COMMAND')
  run(config,request,sys.stdin.buffer,sys.stdout.buffer)
 except Exception as e:
  code=str(e)if re.fullmatch('[A-Z_]+',str(e))else'REPOSITORY_OPERATION_FAILED';sys.stderr.write(code+'\n');sys.exit(1)
if __name__=='__main__':main()
