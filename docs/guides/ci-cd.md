# CI/CD Pipelines

Automate deployment notifications, test suite results, and build failure alerts directly from your CI/CD workflows.

---

## GitHub Actions

Add a step to your `.github/workflows/ci.yml` or deployment pipeline:

### 1. Notify on Build Failure

Add this conditional step at the end of your workflow job to get immediate alerts when a run fails:

```yaml
- name: Notify Telegram on Failure
  if: failure()
  run: |
    curl -s -X POST "${{ secrets.GATEWAY_URL }}/notify" \
      -H "Content-Type: application/json" \
      -H "x-api-key: ${{ secrets.GATEWAY_AUTH_TOKEN }}" \
      -d '{
        "title": "CI Build Failed: '${{ github.repository }}'",
        "message": "Commit [`'${{ github.sha }}'`]('${{ github.server_url }}/${{ github.repository }}/commit/${{ github.sha }}') on branch *'${{ github.ref_name }}'* failed.\n\nAuthor: *'${{ github.actor }}'*",
        "topic": "ci-failures"
      }'
```

### 2. Notify on Production Release

Send an announcement to the `#releases` topic whenever a release tag is pushed:

```yaml
name: Release Notification

on:
  release:
    types: [published]

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Send Telegram Alert
        run: |
          curl -s -X POST "${{ secrets.GATEWAY_URL }}/notify" \
            -H "Content-Type: application/json" \
            -H "x-api-key: ${{ secrets.GATEWAY_AUTH_TOKEN }}" \
            -d '{
              "title": "🚀 Release ${{ github.event.release.tag_name }} Published",
              "message": "New release available for *${{ github.repository }}*!\n\n[View Release Notes](${{ github.event.release.html_url }})",
              "topic": "releases"
            }'
```

---

## GitLab CI

In `.gitlab-ci.yml`:

```yaml
after_script:
  - >
    if [ "$CI_JOB_STATUS" == "failed" ]; then
      curl -s -X POST "$GATEWAY_URL/notify" \
        -H "Content-Type: application/json" \
        -H "x-api-key: $GATEWAY_AUTH_TOKEN" \
        -d "{
          \"title\": \"GitLab Job Failed: $CI_PROJECT_NAME\",
          \"message\": \"Pipeline #$CI_PIPELINE_ID failed on branch **$CI_COMMIT_REF_NAME**.\",
          \"topic\": \"ci\"
        }"
    fi
```
