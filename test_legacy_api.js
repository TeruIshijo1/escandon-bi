async function testAPI() {
  try {
    const res = await fetch('http://192.168.254.21:9000/api/tables');
    const status = res.status;
    const text = await res.text();
    console.log('Status:', status);
    console.log('Body:', text.substring(0, 500));
  } catch (err) {
    console.error('Fetch error:', err);
  }
}
testAPI();
