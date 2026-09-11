/**
 * Curated profession categories. Kept as an enum so the client can render a
 * fixed picker and so discovery/matching can filter on a known vocabulary.
 *
 * Free-text detail (company, school, headline) lives in the profile's
 * `education` field.
 */
export enum Profession {
  TechnologyEngineering = 'technology_engineering',
  DesignCreative = 'design_creative',
  ProductManagement = 'product_management',
  MarketingCommunications = 'marketing_communications',
  SalesBusinessDevelopment = 'sales_business_development',
  FinanceAccounting = 'finance_accounting',
  Consulting = 'consulting',
  HealthcareMedicine = 'healthcare_medicine',
  EducationAcademia = 'education_academia',
  Legal = 'legal',
  ScienceResearch = 'science_research',
  MediaEntertainment = 'media_entertainment',
  HospitalityTourism = 'hospitality_tourism',
  ArtsCulture = 'arts_culture',
  NonProfitSocialWork = 'non_profit_social_work',
  GovernmentPublicService = 'government_public_service',
  EntrepreneurshipFounder = 'entrepreneurship_founder',
  Student = 'student',
  Other = 'other',
}
