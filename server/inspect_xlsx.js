const fetch = require('node-fetch');
const XLSX = require('xlsx');

const url = process.env.PUBLIC_XLSX_URL || 'https://1drv.ms/x/c/b0ddc57c903e39c0/IQBQJjdlhIxnTL8K5I4VFPZ0AbFKBhScCJklrU7aOcltmgo?e=09efqN';
console.log('using url:', url);
(async () => {
  const res = await fetch(url);
  console.log('status', res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = XLSX.read(buf);
  console.log('sheets', wb.SheetNames);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  console.log(JSON.stringify(rows, null, 2));
})();
