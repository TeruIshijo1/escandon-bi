const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    console.log('BROWSER CONSOLE:', msg.type(), msg.text());
  });
  
  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message);
  });
  
  // 1. Ir a login
  await page.goto('http://localhost:5173/login');
  await page.waitForLoadState('networkidle');

  // 2. Llenar credenciales (admin / admin)
  await page.fill('input[type="text"]', 'admin');
  await page.fill('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');

  // 3. Esperar a navegar
  await page.waitForTimeout(2000);
  
  // 4. Ir a siti/dashboard
  await page.goto('http://localhost:5173/siti/dashboard');
  await page.waitForTimeout(3000);
  
  console.log('CURRENT URL:', page.url());

  const content = await page.content();
  console.log('PAGE CONTENT LENGTH:', content.length);
  
  await browser.close();
})();
