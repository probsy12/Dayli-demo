// Inside WeChat's own browser, app downloads and App Store links don't open.
// Ask people to open the page in their phone's browser instead (the ··· menu,
// top right). Included by the invite, join and download pages.
(function () {
  if (!/MicroMessenger/i.test(navigator.userAgent)) return;
  var zh = /^zh/i.test(navigator.language || '');
  var box = document.createElement('div');
  box.setAttribute('role', 'dialog');
  box.style.cssText =
    'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.9);color:#fff;' +
    'font:17px/1.5 -apple-system,"PingFang SC","Segoe UI",Roboto,sans-serif;text-align:right;padding:16px 22px';
  box.innerHTML =
    '<div style="font-size:44px;line-height:1">&#10548;</div>' +
    '<div style="margin:8px 0 0;font-weight:700;font-size:22px;color:#fff">' +
    (zh ? '请在浏览器中打开' : 'Open this in your browser') +
    '</div><div style="margin:8px 0 0;color:#fff;max-width:300px;margin-left:auto">' +
    (zh
      ? '点右上角 ··· ，选择「在浏览器打开」，就能下载 Dayli 或接受邀请。'
      : 'Tap ··· at the top right and choose "Open in Browser" to download Dayli or accept the invitation.') +
    '</div>';
  document.addEventListener('DOMContentLoaded', function () {
    document.body.appendChild(box);
  });
})();
