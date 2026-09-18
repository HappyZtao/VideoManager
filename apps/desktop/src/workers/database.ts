import { LibraryDatabase } from '../../../../packages/persistence/database'
const parent=process.parentPort!
let db: LibraryDatabase
parent.on('message',async event=>{
  const {id,method,args}=event.data
  try {
    if(method==='init'){db=new LibraryDatabase(args[0],args[1]);parent.postMessage({id,result:db.info()});return}
    const fn=(db as unknown as Record<string, (...args: any[])=>unknown>)[method]
    if(typeof fn!=='function'||method==='constructor')throw Error('未知数据库命令')
    parent.postMessage({id,result:await fn.apply(db,args)})
  }catch(error){parent.postMessage({id,error:error instanceof Error?error.message:String(error)})}
})
