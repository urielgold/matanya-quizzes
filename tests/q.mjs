import { sql } from './sql.mjs';
console.log(JSON.stringify(await sql(process.argv[2]),null,1));
