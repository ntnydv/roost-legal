/* ============================================
   Roost Inspect - Shared page chrome
   Renders the site navigation, footer, and
   contact boxes that every page shares.
   ============================================ */
(function () {
  'use strict';

  var SITE = {
    brand: 'Roost Inspect',
    home: 'index.html',
    email: 'contact@my-roost.com',
    location: 'Sydney, NSW, Australia',
    year: 2025,
    navLinks: [
      { href: 'index.html', label: 'Home' },
      { href: 'privacy-policy.html', label: 'Privacy' },
      { href: 'terms-of-service.html', label: 'Terms' },
      { href: 'support.html', label: 'Support' },
      { href: 'account-deletion.html', label: 'Delete Account' }
    ]
  };

  function currentPage() {
    var file = window.location.pathname.split('/').pop();
    return file === '' ? SITE.home : file;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function emailLink(className) {
    return '<a href="mailto:' + SITE.email + '"' +
      (className ? ' class="' + className + '"' : '') +
      '>' + SITE.email + '</a>';
  }

  function navHtml() {
    var page = currentPage();
    var links = SITE.navLinks.map(function (link) {
      var active = link.href === page ? ' class="active"' : '';
      return '<a href="' + link.href + '"' + active + '>' + link.label + '</a>';
    }).join('');

    return '' +
      '<div class="nav-container">' +
        '<a href="' + SITE.home + '" class="nav-brand">' + SITE.brand + '</a>' +
        '<button class="nav-toggle" aria-label="Toggle navigation" aria-expanded="false">' +
          '<span></span><span></span><span></span>' +
        '</button>' +
        '<div class="nav-links">' + links + '</div>' +
      '</div>';
  }

  function footerHtml() {
    return '<p>&copy; ' + SITE.year + ' ' + SITE.brand + '. ' + SITE.location +
      '. All rights reserved.</p>';
  }

  /* Contact boxes differ only by heading and body text, so those come from
     data attributes while the email link stays defined in one place. */
  function contactBoxHtml(el) {
    var heading = el.getAttribute('data-heading') || SITE.brand;
    var body = el.getAttribute('data-body') || SITE.location;
    return '<h3>' + escapeHtml(heading) + '</h3>' +
      '<p>' + escapeHtml(body) + '</p>' +
      emailLink('email-link');
  }

  function bindNavToggle(nav) {
    var toggle = nav.querySelector('.nav-toggle');
    var links = nav.querySelector('.nav-links');
    if (!toggle || !links) return;

    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  function render() {
    var nav = document.querySelector('[data-site-nav]');
    if (nav) {
      nav.className = 'nav-header';
      nav.innerHTML = navHtml();
      bindNavToggle(nav);
    }

    var footer = document.querySelector('[data-site-footer]');
    if (footer) {
      footer.className = 'site-footer';
      footer.innerHTML = footerHtml();
    }

    Array.prototype.forEach.call(
      document.querySelectorAll('[data-contact-box]'),
      function (el) {
        el.className = 'contact-box' + (el.getAttribute('data-class') ? ' ' + el.getAttribute('data-class') : '');
        el.innerHTML = contactBoxHtml(el);
      }
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
