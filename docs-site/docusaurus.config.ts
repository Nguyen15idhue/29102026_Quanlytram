import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Hướng dẫn Quản lý trạm CORS',
  tagline: 'CORS · NTRIP · RTCM',
  favicon: 'img/favicon.svg',
  url: 'http://127.0.0.1:3000',
  baseUrl: '/guide/',
  trailingSlash: true,
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  i18n: {
    defaultLocale: 'vi',
    locales: ['vi']
  },
  clientModules: [require.resolve('./src/clientModules/fonts.ts')],
  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          breadcrumbs: false,
          showLastUpdateAuthor: false,
          showLastUpdateTime: false
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css'
        }
      } satisfies Preset.Options
    ]
  ],
  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        language: ['en'],
        docsRouteBasePath: '/',
        indexBlog: false,
        indexPages: false,
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
        searchBarShortcutHint: true
      }
    ]
  ],
  themeConfig: {
    colorMode: {
      defaultMode: 'light',
      disableSwitch: false,
      respectPrefersColorScheme: true
    },
    navbar: {
      title: 'Hướng dẫn',
      hideOnScroll: false,
      items: []
    },
    docs: {
      sidebar: {
        hideable: true,
        autoCollapseCategories: true
      }
    },
    tableOfContents: {
      minHeadingLevel: 2,
      maxHeadingLevel: 3
    }
  } satisfies Preset.ThemeConfig
};

export default config;
