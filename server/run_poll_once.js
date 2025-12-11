process.env.PUBLIC_XLSX_URL = 'https://1drv.ms/x/c/b0ddc57c903e39c0/IQBQJjdlhIxnTL8K5I4VFPZ0AbFKBhScCJklrU7aOcltmgo?e=pnFRfd';
const { syncFromForms } = require('./poller');

(async () => {
  try {
    const result = await syncFromForms();
    console.log(result);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
