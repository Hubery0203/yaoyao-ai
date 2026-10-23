/** Postgres-authoritative continuity worker. No user data is logged. */
import { runContinuityOnce } from "@yaoyao/application";
import type { UserId } from "@yaoyao/domain";
import { createLogger, createPgPool, loadConfig, PostgresTransactionManager } from "@yaoyao/infrastructure";
async function main():Promise<void> {
  const config=loadConfig();
  const logger=createLogger(config).child({host:"worker"});
  if(!config.DATABASE_URL) throw new Error("DATABASE_URL is required for the continuity worker");
  const pool=createPgPool({connectionString:config.DATABASE_URL});
  const manager=new PostgresTransactionManager(pool);
  let stopping=false;
  let wake:(()=>void)|undefined;
  const stop=()=>{stopping=true;wake?.();};
  process.on("SIGTERM",stop); process.on("SIGINT",stop);
  logger.info({ownerCount:config.CONTINUITY_USER_IDS.length},"continuity worker started");
  try {
    while(!stopping) {
      for(const owner of config.CONTINUITY_USER_IDS) {
        if(stopping) break;
        try {
          const outcome=await runContinuityOnce(manager,owner as UserId);
          if(outcome!=="idle") logger.info({outcome},"continuity pass finished");
        } catch { logger.error("continuity pass failed; retrying on next poll"); }
      }
      if(!stopping) await new Promise<void>(resolve=>{
        const timer=setTimeout(()=>{wake=undefined;resolve();},config.CONTINUITY_POLL_MS);
        wake=()=>{clearTimeout(timer);wake=undefined;resolve();};
      });
    }
  } finally {
    await pool.end();
    process.off("SIGTERM",stop);process.off("SIGINT",stop);
    logger.info("continuity worker stopped");
  }
}
main().catch(()=>{console.error("Continuity worker failed to start");process.exitCode=1;});
