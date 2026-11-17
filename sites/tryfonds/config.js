(function () {
  const hostname = window.location.hostname;
  const isLocal = hostname === '127.0.0.1' || hostname === 'localhost';
  window.TRYFONDS = {
    githubUrl: 'https://github.com/filoucool/fonds',
    demoUrl: isLocal ? `${window.location.protocol}//${hostname}:8081` : 'https://demo.tryfonds.com',
    releasesApi: 'https://api.github.com/repos/filoucool/fonds/releases',
    repoName: 'filoucool/fonds',
  };
})();