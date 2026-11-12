import { expect, test } from '@playwright/test';
import { REPO_TABS } from '../fixtures/routes';
import { readSeedState, type SeedState } from '../lib/seed-state';

let seed: SeedState;

type TabExpectation = {
  tab: (typeof REPO_TABS)[number];
  assert: (page: import('@playwright/test').Page) => Promise<void>;
};

const TAB_EXPECTATIONS: TabExpectation[] = [
  {
    tab: 'overview',
    assert: async (page) => {
      await expect(page.getByRole('button', { name: 'Synchronize' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Verify' })).toBeVisible();
    },
  },
  {
    tab: 'files',
    assert: async (page) => {
      await expect(page.getByRole('button', { name: 'README.md' })).toBeVisible({ timeout: 15_000 });
    },
  },
  {
    tab: 'commits',
    assert: async (page) => {
      await expect(page.getByRole('table')).toBeVisible();
      await expect(page.locator('table tbody tr').first()).toBeVisible();
    },
  },
  {
    tab: 'refs',
    assert: async (page) => {
      await expect(page.getByText('main', { exact: false })).toBeVisible();
    },
  },
  {
    tab: 'issues',
    assert: async (page) => {
      await expect(page.getByText(/no issues archived/i)).toBeVisible();
    },
  },
  {
    tab: 'pulls',
    assert: async (page) => {
      await expect(page.getByText(/no pull requests archived/i)).toBeVisible();
    },
  },
  {
    tab: 'releases',
    assert: async (page) => {
      await expect(page.getByText(/no releases archived/i)).toBeVisible();
    },
  },
  {
    tab: 'lfs',
    assert: async (page) => {
      await expect(page.getByText(/no lfs objects archived/i)).toBeVisible();
    },
  },
  {
    tab: 'discussions',
    assert: async (page) => {
      await expect(page.getByText(/no discussions archived/i)).toBeVisible();
    },
  },
  {
    tab: 'components',
    assert: async (page) => {
      await expect(page.getByRole('row').filter({ hasText: 'Git' })).toContainText('complete');
    },
  },
  {
    tab: 'events',
    assert: async (page) => {
      const empty = page.getByText('No events', { exact: true });
      const table = page.getByRole('table', { name: 'Repository events' });
      await expect(empty.or(table)).toBeVisible();
    },
  },
  {
    tab: 'health',
    assert: async (page) => {
      await expect(page.getByRole('button', { name: 'Verify' })).toBeVisible();
    },
  },
  {
    tab: 'search-index',
    assert: async (page) => {
      await expect(page.getByRole('heading', { name: 'Search index', level: 2 })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Rebuild' })).toBeVisible();
    },
  },
  {
    tab: 'snapshots',
    assert: async (page) => {
      await expect(page.getByText(/no snapshots yet/i)).toBeVisible();
    },
  },
];

// @suite ui.repo.with-data.tabs
test.describe('seeded repository', () => {
  test.beforeAll(() => {
    seed = readSeedState();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(`/repositories/${seed.repositoryId}/overview`);
    await expect(page.getByRole('heading', { name: seed.displayName, level: 1 })).toBeVisible({ timeout: 15_000 });
  });

  for (const { tab, assert } of TAB_EXPECTATIONS) {
    test(`${tab} tab shows archived data`, async ({ page }) => {
      const tabLink = page.getByRole('navigation', { name: 'Repository' }).getByRole('link', { name: tabLabel(tab) });
      await tabLink.click();
      await expect(page).toHaveURL(new RegExp(`/repositories/${seed.repositoryId}/${tab}`));
      await assert(page);
    });
  }

  // @suite ui.repo.with-data.overview
  // @suite ui.repo.with-data.files
  // @suite ui.repo.with-data.commits
  // @suite ui.repo.with-data.health
  test('repository appears on the repositories list', async ({ page }) => {
    await page.goto('/repositories');
    await expect(page.getByRole('link', { name: seed.displayName })).toBeVisible();
  });
});

function tabLabel(slug: (typeof REPO_TABS)[number]): string {
  const labels: Record<(typeof REPO_TABS)[number], string> = {
    overview: 'Overview',
    files: 'Files',
    commits: 'Commits',
    refs: 'Refs',
    issues: 'Issues',
    pulls: 'Pulls',
    releases: 'Releases',
    lfs: 'LFS',
    discussions: 'Discussions',
    components: 'Components',
    events: 'Events',
    health: 'Health',
    'search-index': 'Search index',
    snapshots: 'Snapshots',
  };
  return labels[slug];
}
