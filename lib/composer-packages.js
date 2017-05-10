const _ = require('lodash'),
      request = require('request-promise'),
      url = require('url')

var composerPackages = {
  
  /**
   * List of packages to return (provided as argument)
   * @type {Array}
   */
  packages: [],
  
  /**
   * Repository URL (provided as argument)
   * @type {String}
   */
  repository: '',
  
  /**
   * 
   * @type {String}
   */
  host: '',
  
  /**
   * Syntax to follow to create a provider/module URL ("/8/%package%$%hash%.json")
   * @type {String}
   */
  providersUrl: '',
  
  init: function(repository, packages) {
    // Build baseUrl
    const urlParts = url.parse(repository)
    this.host = `${urlParts.protocol}//${urlParts.host}`
    // Set global variables
    this.repository = repository
    this.packages = packages
    // Execute main operations and return promise when complete
    return new Promise((resolve, reject) => {
      this.getPackages()
        .then(resolve)
        .catch(reject)
    })
  },
  
  /**
   * Primary function to return package/module information based on provided packages
   * 
   * @param  {Array}    packages   Array of packages
   * @return {Promise}             Promise with retrieved package data
   */
  getPackages: function() {
    const result = new Promise((resolve, reject) => {
      this.getSources()
        .then((packageUrls) => {
          // Filter the full list of package URls down to only those requested
          const requestedPackages = _.pickBy(packageUrls, (value, key) => {
            return _.includes(this.packages, key)
          })
          // Build array reqest promises from provided URLs
          const promises = Object.values(requestedPackages).map(url => request(url));
          Promise.all(promises)
            .then((pagedPackageData) => {
              const mergedPackageData = {}
              // Combine and parse pages of results
              pagedPackageData.map((page) => {
                page = JSON.parse(page)
                _.merge(mergedPackageData, page.packages)
              })
              // Send resolve with processed data
              resolve(mergedPackageData)
            // Catch error from request() and send to parent promise
            }).catch(reject)
        // Catch error from this.getSources
        }).catch(reject)
    })
    // Return promise
    return result
      
  },
  
  /**
   * Works with processSources to build a list of URLs for every package in the repository
   * 
   * @return {Object} Every package and its metadata URL
   */
  getSources: function() {
    const result = new Promise((resolve, reject) => {
      request(this.repository + '/packages.json')
        .then((manifest) => {
          manifest = JSON.parse(manifest)
          this.processSources(manifest)
            .then((packageUrls) => {
              // Send package URLs to the parent promise
              resolve(packageUrls)
            // Catch error from this.processSources and send to parent promise
            }).catch(reject)
        // Catch error from request() and send to parent promise    
        }).catch(reject)
    })
    return result
  },
  
  /**
   * Loops through retrieved manifest's sources to build list of package URLs
   * 
   * @param  {Object} manifest  Manifest returned from: repository + '/packages.json'
   * @return {Object}           Return every listed package and its metadata URL
   */
  processSources(manifest) {
    // For later use
    this.providersUrl = manifest['providers-url']
    const providers = manifest['provider-includes']
    const providerUrls = []
    Object.keys(providers).map((provider) => {
      const uri = provider.replace('%hash%', providers[provider].sha256)
      providerUrls.push(`${this.repository}/${uri}`)
    })
    const promises = providerUrls.map(url => request(url));
    const result = new Promise((resolve, reject) => {
      Promise.all(promises)
        .then((pagedPackageList) => {
          const packageUrls = {}
          const mergedPackageList = {}
          // Combine pages of returned results into a single list of packages
          pagedPackageList.map((page) => {
            page = JSON.parse(page)
            _.merge(mergedPackageList, page.providers)
          })
          // Build package urls from combined results
          Object.keys(mergedPackageList).map((packageKey) => {
            // Replace components based on template (/%package%$%hash%.json)
            const uri = this.providersUrl
                          .replace('%package%', packageKey)
                          .replace('%hash%', mergedPackageList[packageKey].sha256)
            // Update package URLs with result              
            packageUrls[packageKey] = this.host + uri
          })
          // Send resolution with processed package URLs
          resolve(packageUrls)
        // Catch error from request() and send to parent promise
        }).catch(reject)
    })
    return result
  }
}

module.exports = composerPackages.init

// If the file is being called directly (for debugging)
if (require.main === module) {
  const host = 'https://packages.drupal.org/8'
  const packages = [ 
    'drupal/auto_nodetitle',
    'drupal/geophp',
    'drupal/menu_target',
    'drupal/redirect' 
  ]
  composerPackages.init(host, packages)
    .then((packageData) => {
      console.log(packageData)
    })
    .catch((err) => {
      console.log('There was an error')
    })
}
