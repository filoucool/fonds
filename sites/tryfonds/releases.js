const cfg = window.TRYFONDS;
const statusEl = document.getElementById('status');
const listEl = document.getElementById('releases');
document.getElementById('releases-github').href = `${cfg.githubUrl}/releases`;

function renderRelease(release, index) {
  const tag = release.tag_name;
  const li = document.createElement('li');
  li.className = 'release-card';
  const h2 = document.createElement('h2');
  h2.textContent = tag + (index === 0 ? ' · Latest' : '');
  const meta = document.createElement('p');
  meta.className = 'release-meta';
  meta.textContent = new Date(release.published_at).toLocaleDateString();
  const links = document.createElement('p');
  links.innerHTML = [
    `<a href="${cfg.githubUrl}/archive/refs/tags/${tag}.zip">Source (.zip)</a>`,
    `<a href="${cfg.githubUrl}/archive/refs/tags/${tag}.tar.gz">Source (.tar.gz)</a>`,
    `<a href="${cfg.githubUrl}/releases/tag/${tag}">Release notes</a>`,
  ].join(' · ');
  li.append(h2, meta, links);
  const assets = release.assets ?? [];
  if (assets.length) {
    const ul = document.createElement('ul');
    for (const a of assets) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = a.browser_download_url;
      link.textContent = a.name;
      item.appendChild(link);
      ul.appendChild(item);
    }
    li.appendChild(ul);
  }
  return li;
}

fetch(cfg.releasesApi, { headers: { Accept: 'application/vnd.github+json' } })
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
  .then((data) => {
    statusEl.hidden = true;
    listEl.hidden = false;
    data.forEach((r, i) => listEl.appendChild(renderRelease(r, i)));
  })
  .catch(() => {
    statusEl.className = 'status error';
    statusEl.textContent = 'Could not load releases.';
  });