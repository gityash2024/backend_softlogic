import { buildGoogleBillingQuery } from '../ai.google-billing';

describe('AI Google billing verification', () => {
  it('builds a Gemini-only BigQuery billing export query for the configured table', () => {
    const query = buildGoogleBillingQuery('billing-project.billing_export.gcp_billing_export_v1');

    expect(query).toContain('`billing-project.billing_export.gcp_billing_export_v1`');
    expect(query).toContain('project.id = @projectId');
    expect(query).toContain('usage_start_time >= @startDate');
    expect(query).toContain("LOWER(service.description) LIKE '%gemini%'");
    expect(query).toContain("LOWER(sku.description) LIKE '%imagen%'");
    expect(query).toContain('GROUP BY usageDate, projectId, serviceDescription, skuDescription');
  });

  it('sanitizes backticks from table identifiers before embedding them', () => {
    const query = buildGoogleBillingQuery('billing-project.dataset.`unsafe`');

    expect(query).toContain('`billing-project.dataset.unsafe`');
    expect(query).not.toContain('``');
  });
});
