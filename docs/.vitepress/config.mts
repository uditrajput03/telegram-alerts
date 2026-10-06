import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Telegram Alerts',
  description: 'Serverless notification gateway on Cloudflare Workers & Hono',
  base: '/telegram-alerts/',
  cleanUrls: true,
  lastUpdated: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/telegram-alerts/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#229ed9' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Telegram Notification Gateway' }],
    ['meta', { property: 'og:description', content: 'Serverless notification gateway on Cloudflare Workers & Hono. Route alerts to auto-created Telegram forum topics.' }]
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Telegram Alerts',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API Reference', link: '/reference/api' },
      { text: 'Recipes', link: '/guides/webhooks' },
      {
        text: 'v1.0.0',
        items: [
          { text: 'Changelog', link: 'https://github.com/uditrajput03/telegram-alerts/releases' },
          { text: 'Contributing', link: 'https://github.com/uditrajput03/telegram-alerts/blob/main/CONTRIBUTING.md' }
        ]
      }
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Configuration & Secrets', link: '/guide/configuration' },
          { text: 'Architecture', link: '/guide/architecture' }
        ]
      },
      {
        text: 'API & Reference',
        items: [
          { text: 'REST API', link: '/reference/api' },
          { text: 'Web Composer (/send)', link: '/reference/web-composer' },
          { text: 'Telegram Bot Commands', link: '/reference/bot-commands' },
          { text: 'Payloads & Formatting', link: '/reference/payloads' }
        ]
      },
      {
        text: 'Guides & Recipes',
        items: [
          { text: 'Webhook Integrations', link: '/guides/webhooks' },
          { text: 'CI/CD Pipelines', link: '/guides/ci-cd' },
          { text: 'Cron & Shell Scripts', link: '/guides/cron-jobs' }
        ]
      }
    ],

    search: {
      provider: 'local',
      options: {
        detailedView: true
      }
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/uditrajput03/telegram-alerts' }
    ],

    editLink: {
      pattern: 'https://github.com/uditrajput03/telegram-alerts/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },

    footer: {
      message: 'Released under the Apache-2.0 License.',
      copyright: 'Copyright © 2025-present Udit Rajput'
    }
  }
})
