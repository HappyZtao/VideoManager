/** Consume newly discovered work immediately, without breadth-level barriers. */
export function runWorkQueue<T>(initial:T[],concurrency:number,visit:(item:T,enqueue:(item:T)=>void)=>Promise<void>):Promise<void>{
  const queue=[...initial];let active=0;let failure:unknown
  return new Promise((resolve,reject)=>{
    const enqueue=(item:T)=>{queue.push(item);pump()}
    const pump=()=>{
      while(!failure&&active<concurrency&&queue.length){
        const item=queue.shift()!;active++
        void Promise.resolve().then(()=>visit(item,enqueue)).catch(error=>{failure=error}).finally(()=>{active--;pump()})
      }
      if(!active){if(failure)reject(failure);else if(!queue.length)resolve()}
    }
    pump()
  })
}
