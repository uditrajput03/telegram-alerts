# Webhook Integrations

Learn how to connect third-party services and webhooks to **Telegram Alerts Gateway**.

---

## GitHub Webhooks

Route repository events (issues, pull requests, releases, stars) straight to Telegram:

### Setup in GitHub
1. Navigate to your GitHub repository $\rightarrow$ **Settings** $\rightarrow$ **Webhooks** $\rightarrow$ **Add webhook**.
2. **Payload URL**: `https://<YOUR_WORKER_URL>/notify?topic=github&title=GitHub+Event&token=<AUTH_TOKEN>`
3. **Content type**: `application/json`
4. **Events**: Select *"Send me everything"* or choose individual events (e.g. Issues, Pull requests, Releases).

GitHub's payload will land safely in your `#github` topic.

---

## Stripe Webhooks

Receive real-time notifications for successful payments, new subscriptions, or failed charges:

### Setup in Stripe
1. Go to the [Stripe Dashboard](https://dashboard.stripe.com/) $\rightarrow$ **Developers** $\rightarrow$ **Webhooks**.
2. Click **Add endpoint**.
3. **Endpoint URL**: `https://<YOUR_WORKER_URL>/notify?topic=stripe&title=Stripe+Event&token=<AUTH_TOKEN>`
4. **Events to listen to**:
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.created`

The gateway's catchall and JSON payload parser will render the Stripe event summary into your `#stripe` topic.

---

## Grafana & Prometheus Alerts

Send alerts when server CPU, memory, or error rates exceed thresholds.

### Setup in Grafana Contact Points
1. In Grafana, navigate to **Alerting** $\rightarrow$ **Contact points** $\rightarrow$ **New contact point**.
2. **Integration**: Select **Webhook**.
3. **URL**: `https://<YOUR_WORKER_URL>/notify?topic=monitoring`
4. **HTTP Method**: `POST`
5. **HTTP Headers**:
   - Header: `x-api-key`
   - Value: `<AUTH_TOKEN>`
6. Save and test the contact point.

---

## Supabase Database Webhooks

Trigger alerts whenever a new record is inserted into Postgres (e.g. new users or high-value orders):

```sql
-- In Supabase SQL Editor:
create trigger on_new_user
  after insert on auth.users
  for each row execute function
  supabase_functions.http_request(
    'https://<YOUR_WORKER_URL>/notify?topic=users&title=New+User+Signup&token=<AUTH_TOKEN>',
    'POST',
    '{"Content-Type": "application/json"}',
    '{}',
    '1000'
  );
```
