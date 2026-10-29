/* Phase 1: the foundation demo (src/ui/demo.js): focus across 3 rows x 40 cards, Back, hold OK, toast, the mock. */
export default [{
  name: 'phase1-demo',
  dir: 'phase1',
  url: '/?clock=12:03%20AM',
  async run({ page, press, hold, shot, expect, focused }) {
    const rowOf = async (g) => page.evaluate((name) => document.querySelector('[data-focus-group="' + name + '"]').querySelectorAll('.card').length, g);

    // posters (generated SVG data URIs, through the image loader) have loaded
    await page.waitForFunction(() => document.querySelectorAll('.card-img.on').length > 5, null, { timeout: 8000 });
    let f = await focused();
    expect(f && f.group === 'row-0' && f.index === 0, 'Home starts on the first card of the first row');
    await shot('01-home');

    await press('right', 5);
    f = await focused();
    expect(f.group === 'row-0' && f.index === 5, 'Right x5 moves to card 5 (got ' + f.index + ')');
    await shot('02-home-card5');

    await press('right', 40, 25);
    f = await focused();
    expect(f.index === 39, 'Right past the end stops on the last card, 39 (got ' + f.index + ')');
    const alive = await rowOf('row-0');
    expect(alive > 0 && alive <= 30, 'the row keeps few cards mounted (' + alive + ' of 40)');
    await shot('03-home-last-card');

    await press('left', 34, 25);
    f = await focused();
    expect(f.index === 5, 'Left x34 comes back to card 5 (got ' + f.index + ')');

    await press('down');
    f = await focused();
    expect(f.group === 'row-1' && f.index === 5, 'Down lands on the same index of the next row (' + f.group + ' ' + f.index + ')');
    await shot('04-second-row');
    await press('down');
    f = await focused();
    expect(f.group === 'row-2' && f.index === 5, 'Down again: third row, same index');
    await shot('05-third-row');
    await press('down');
    f = await focused();
    expect(f.group === 'row-2', 'Down at the last row stays put');

    await press('up', 2);
    f = await focused();
    expect(f.group === 'row-0' && f.index === 5, 'Up x2 returns to the first row (' + f.group + ' ' + f.index + ')');
    await press('up');
    f = await focused();
    expect(f && f.nav, 'Up from the first row reaches the top bar (' + (f && f.nav) + ')');
    await shot('06-top-bar');
    await press('down');
    f = await focused();
    expect(f.group === 'row-0' && f.index === 5, 'Down from the top bar returns to where the row was left');

    // OK opens the stub title page; Back closes it and focus is where it was
    await press('ok');
    let names = await page.evaluate(() => window.__alder.router.names());
    expect(names.join() === 'home,stub', 'OK pushes the stub screen (' + names + ')');
    await shot('07-stub-title-page');
    await press('back');
    names = await page.evaluate(() => window.__alder.router.names());
    f = await focused();
    expect(names.join() === 'home' && f.group === 'row-0' && f.index === 5, 'Back pops and focus returns to card 5');

    // hold OK opens the options panel; Back closes it
    await hold('ok');
    let panel = await page.evaluate(() => !!document.querySelector('.panel'));
    f = await focused();
    expect(panel && f.cls.indexOf('row-item') >= 0, 'hold OK opens the panel with focus inside it');
    await shot('08-options-panel');
    await press('down');
    f = await focused();
    expect(f.text === 'Mark as watched', 'Down inside the panel moves to the next option (' + f.text + ')');
    await press('back');
    panel = await page.evaluate(() => !!document.querySelector('.panel'));
    f = await focused();
    expect(!panel && f.group === 'row-0' && f.index === 5, 'Back closes the panel and gives focus back');

    // Back on the first screen asks the app to exit: on a desktop the mock says so with a toast
    await press('back');
    const toast = await page.evaluate(() => { const t = document.querySelector('.toast'); return t ? t.textContent : null; });
    const exits = await page.evaluate(() => window.__mockExitRequested || 0);
    expect(exits === 1 && toast && /leave|exit/i.test(toast), 'Back on Home requests exit (exit calls ' + exits + ', toast "' + toast + '")');
    await shot('09-exit-toast');

    // the Tizen mock is there
    const mock = await page.evaluate(() => ({
      ud: window.webapis.productinfo.isUdPanelSupported(), hdr: window.webapis.avinfo.isHdrTvSupport(),
      keys: window.tizen.__registeredKeys().length, state: window.webapis.avplay.getState(),
    }));
    expect(mock.ud === true && mock.hdr === true && mock.keys > 10 && mock.state === 'NONE', 'the Tizen mock is installed (' + JSON.stringify(mock) + ')');

    // focus latency: 30 moves along a row, timed in the page (no throttle: < 50 ms each is the budget)
    const ms = await page.evaluate(() => {
      const e = window.__alder.engine;
      const t0 = performance.now();
      for (let i = 0; i < 30; i++) e.move('left');
      for (let i = 0; i < 30; i++) e.move('right');
      return (performance.now() - t0) / 60;
    });
    expect(ms < 50, 'a focus move takes ' + ms.toFixed(2) + ' ms on average (budget 50 ms)');
  },
}];
