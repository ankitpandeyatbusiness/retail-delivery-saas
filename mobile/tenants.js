// Name, package and colour of each shop's app. The ONE list: app.config.js and scripts/release.js both read it.
// Add a shop here, then add its "<slug>-preview" profile to eas.json (channel = the slug).
module.exports = {
  default: {
    name: 'Retail SaaS',
    bundleId: 'com.ankit.retailsaas',
    backgroundColor: '#ffffff',
  },
  savera: {
    name: 'Savera',
    bundleId: 'com.savera.app',
    backgroundColor: '#E23744',
  },
  burgerking: {
    name: 'Burger King',
    bundleId: 'com.burgerking.app',
    backgroundColor: '#D62300',
  },
};
