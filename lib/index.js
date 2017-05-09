'use strict'

const config = require('./config'),
      drupalPackages = require('./drupal-packages'),
      fs = require('fs'),
      path = require('path'),
      yaml = require('js-yaml'),
      inquirer = require('inquirer'),
      request = require('request-promise'),
      colors = require('colors'),
      _ = require('lodash') 
      
const app = {
  config: config,
  currPath: path.resolve('.'),
  appPath: '',
  appDir: '',
  composerLocal: {},
  drupalVer: '',
  newComposer: {},
  moduleErrors: [],
  remoteTemplates: {},
  devModules: [],
  versionConstraint: '',
  prompt: function() {
    const questions = [{
      type: 'confirm',
      name: 'composerExists',
      message: 'A composer.json file exists in your project root.  Are you sure you want to overwrite it?',
      when: () => {
        return fs.existsSync(path.join(this.currPath, 'composer.json'))
      }
    },
    {
      type: 'input',
      name: 'drupalLocation',
      message: 'Where is your Drupal app located?',
      default: this.config.drupalRoot,
      validate: (input) => {
        const appPath = path.join(this.currPath, input)
        if (!fs.existsSync(appPath)) {
          return `${appPath} is not valid please try again with a valid directory`
        }
        // If it exists set it globally and return as valid
        this.appDir = input
        this.appPath = appPath
        return true
      },
      when: (answers) => {
        // Only ask this question the composer question passed
        return (answers.hasOwnProperty('composerExists')) ? answers.composerExists : true
      }
    },
    {
      type: 'list',
      name: 'versionConstraint',
      message: 'What version constraint would you like to use for Drush installed modules?',
      choices: [{
        name: 'Carat (^)',
        value: '^'
      },
      {
        name: 'Tilde (~)',
        value: '~'
      },
      {
        name: 'Exact (None)',
        value: ''
      }],
      default: '^',
      when: (answers) => {
        // Only ask this question the composer question passed
        return (answers.hasOwnProperty('composerExists')) ? answers.composerExists : true
      }
    }]
    return inquirer.prompt(questions).then(this.init.bind(this))
  },
  init: function(answers) {
    // Fires when the user has indicated that they don't want to overwrite their composer file
    if(Object.keys(answers).length == 1 && answers.hasOwnProperty('composerExists')) {
      return console.log('Exiting function. This system requires that a new composer file be written.'.red)
    }
    // Map version constraint for later use
    this.versionConstraint = answers.versionConstraint
    const composerLocal = this.getComposerLocal()
    // Make sure the composer file has the contents we need to continue!
    if(!composerLocal.hasOwnProperty('replace')) {
      var msg = `Local composer file at ${path.join(this.appPath, 'composer.json')} `
              + `does not contain the "require" property.  Please check it and try again!` 
      return console.error(msg.red)
    }
    const drupalVer = composerLocal.replace['drupal/core'].replace(/[^0-9.]/g, '')
    this.drupalVer = drupalVer
    console.log('Retreiving remote templates from repositories\n')
    // Once all remote templates are downloaded begin primary operations
    return this.getRemoteTemplates()
      .then(this.buildNewComposer.bind(this))
      .catch((err) => {
        return console.error('Error: ', err)
      })
  },
  buildNewComposer: function(remoteTemplates) {
    console.log('Building new composer file from default composer and installed modules\n')
    this.remoteTemplates = remoteTemplates
    // Create the new composer file from the remote default
    this.newComposer = remoteTemplates.drupalComposer
    // Compare local composer against original to determine which were installed
    const composerModules = this.shallowDiff(
                                this.composerLocal.require, 
                                remoteTemplates.drupalDefaultComposer.require)
    const drushModules = {}
    const modulePaths = Object.keys(this.config.modulePaths)
    // Construct composer syntax for all currently isntalled modules
    modulePaths.map((key, i) => {
      const baseModulePath = this.config.modulePaths[key]
      const modulePath = path.join(this.appPath, baseModulePath)
      drushModules[modulePaths[i]] = this.getDrushModules(modulePath)
    })
    
    if(Object.keys(drushModules.base).length && Object.keys(drushModules.contrib).length) {
      const msg = 'WARNING: '.red 
                + 'You have modules in both "modules/" and "modules/contrib/". '
                + 'You should remove anything in "modules/" or it will be duplicated '
                + 'since this composer build only supports "modules/contrib/"!\n'
      console.log(msg)
    }
    
    // Combine all known modules for composer
    const combinedModules = _.defaults(
                              drushModules.base,
                              drushModules.contrib,
                              composerModules,
                              remoteTemplates.drupalComposer['require'])
    // Replace the defaults with new combined & sorted modules
    this.newComposer['require'] = this.sortKeysBy(combinedModules)
    // Combine all known modules for composer
    const combinedDevModules = _.defaults(
                              drushModules.dev,
                              remoteTemplates.drupalComposer['require-dev'])
    // Replace the defaults with new combined & sorted modules
    this.newComposer['require-dev'] = this.sortKeysBy(combinedDevModules)
    
    // Update installer paths to use provided app directory
    const pathsOrig = this.newComposer.extra['installer-paths']
    const pathsNew = {}
    Object.keys(pathsOrig).map((key) => {
      const newPath = key.replace(/^web\/+/, `${this.appDir}/`)
      pathsNew[newPath] = pathsOrig[key]
    })
    this.newComposer.extra['installer-paths'] = pathsNew
    
    // Prompt the user to resolve package errors (if there were any)
    inquirer.prompt([{
      type: 'confirm',
      name: 'handleErrors',
      message: 'Do you want us to try and get the right versions for the packages with errors?',
      when: () => {
        // Only ask this question if there are errors
        return (this.moduleErrors.length > 0) ? true : false
      }
    }])
    .then((answers) => {
      // If the user was prompted re. errors and wants to handle them
      if(answers.hasOwnProperty('handleErrors') && answers.handleErrors) {
        return this.handleModuleErrors()
      }
      // Otherwise, once complete begin the installation process
      return this.installComposerSystem()
    })
  },
  handleModuleErrors: function() {
    
    console.log('handling errors!')
    
    drupalPackages.get(packages)
      .then((packageData) => {
        console.log(packageData)
        return this.installComposerSystem()
      })
      .catch((err) => {
        console.log('There was an error')
      })
  },
  installComposerSystem: function() {
    console.log('Creating directories: "drush" and "scripts/composer" unless they already exist\n')
    const dirs = {
      'drush': path.join(this.currPath,'drush'),
      'scripts': path.join(this.currPath,'scripts'),
      'scripts/composer': path.join(this.currPath, 'scripts/composer')
    }
    Object.values(dirs).map((dir) => {
      try {
        fs.mkdirSync(dir);
      } catch(err) {
        // Ignore errors from existing directories
      }
    })
    
    console.log('Writing dependency files to filesystem\n')
    // Setup the files we want to process from config
    const processFiles = { 
      'drupalComposerDrush' : 'drush',
      'drupalComposerScriptHandler' : 'scripts/composer'
    }
    // Loop through them and write out the corresponding files
    Object.keys(processFiles).map((key) => {
      const url = this.config.codeTemplates[key]
      const file = url.split('/').pop()
      const dir = dirs[processFiles[key]]
      fs.writeFileSync(path.join(dir, file), this.remoteTemplates[key])
    })
    
    console.log('Writing main composer file\n')
    const newComposer = JSON.stringify(this.newComposer, null, 4)
    fs.writeFileSync(path.join(this.currPath, 'composer.json'), newComposer)
    
    console.log('Emptying original composer file\n')
    //fs.writeFileSync(path.join(this.appPath, 'composer.json'), '{\n}')
    // Finished operations!
    return this.operationComplete()
  },
  operationComplete: function() {
    let msg = `All operations are complete! If there are modules that need to `
            + `be installed from errors install them now, then run: \n`
    console.log(msg)
    console.log('composer install\n'.green)
        msg = `We recommend clearing your modules directory before running "composer install": \n`
    console.log(msg)
    console.log(`rm -rf ${this.appDir}/modules/*\n`.green)
        msg = `When you are ready to remove composer-controlled modules from `
            + `your repository add the following lines: \n`
    console.log(msg)
    console.log(this.remoteTemplates.drupalComposerIgnore.green)
        msg = `\nIMPORTANT COMPOSER NOTE:`.red
            + ` This is simply a tool to help you construct a new composer file. `
            + ` You will likely want to make updates to the generated to suit your needs`
    console.log(msg)
    if(this.devModules.length) {
        msg = `\nDEV MODULE WARNING:`.red
            + ` Consider upgrading the following dev modules when you're done: `
            + this.devModules.join(', ').red
            + `\n\nIf there's a release for any they can be downloaded with:\n`
      console.log(msg)
      console.log(`composer require ${this.devModules.join(' ')}\n`.green)
      console.log(this.moduleErrors)
    }
  },
  getRemoteTemplates: function() {
    const templates = this.config.codeTemplates
    const urls = Object.values(templates)
    const replacements = { ver: `${this.drupalVer}.x` }
    const results = {}
    // Replace tokens in URLs with replacements object
    urls.map((url, i) => {
      urls[i] = this.templateReplace(url, replacements)
    })
    // Build promises for request module with provided URLs
    const promises = urls.map(url => request(url));
    // Return a promise once all urls have been retrieved
    return new Promise((resolve, reject) => {
      Promise.all(promises)
        .then((data) => {
          Object.keys(templates).map((template, i) => {
            const ext = urls[i].split('.').pop()
            if(ext == 'json') {
              return results[template] = JSON.parse(data[i])
            }
            return results[template] = data[i]
          })
          resolve(results)
        })
        .catch(reject)
    })   
  },
  getComposerLocal: function(appPath) {
    appPath = this.appPath || appPath
    const composerPath = path.join(appPath,'composer.json')
    if (!fs.existsSync(composerPath)) {
      return console.error(`${composerPath} doesn't exist, please check your Drupal installation`)
    }
    const contents = fs.readFileSync(composerPath, 'utf8')
    return this.composerLocal = JSON.parse(contents)
  },
  getDrushModules: function(moduleDir) {
    const composerJson = {}
    this.getModuleDirs(moduleDir).map(module => {
      const configFile = `/${module}.info.yml`
      const configPath = path.join(moduleDir, module, configFile)
      try {
        if (!fs.existsSync(configPath)) return
        const contents = fs.readFileSync(configPath, 'utf8')
        // Parse YML into object
        const config = yaml.safeLoad(contents)
        // Reconstruct the version since composer and Drupal don't seem to agree on syntax!
        const verArray = config.version.split('-')
        if(verArray.length < 2) throw `The version in ${configPath} is not valid`
        let verConstraint = this.versionConstraint // ^ ~ or empty 
        let verString = `${verArray[1]}`
        // If the version contains a version state (alpha, beta, dev) append it
        // This will construct the string to follow standard format: 1.0@alpha
        if(2 in verArray) {
          let stability = verArray[2] // aplpha, beta, dev, etc
          let symbol = '@' // 
          if(verArray[2] == 'dev') {
            symbol = '-' // dev uses dashes not @ symbol
            verConstraint = '' // dev does not have a version constraint
            // Track dev modules to message warning to the user
            this.devModules.push(`drupal/${module}`)
          }
          // Remove status number from string (e.g. from alpha8 to aplha)
          stability = stability.replace(/[0-9]/g, '')
          verString += symbol + stability
        }
        composerJson[`drupal/${module}`] = verConstraint + verString
      } catch (e) {
        // Track the bad modules and delete them from composerJson
        this.moduleErrors.push(`drupal/${module}`)
        delete composerJson[`drupal/${module}`]
        // Write our messages to users
        const msg = `Error parsing ${configPath}. Check the config file to `
                  + `ensure it's properly properly formatted in YML and has a `  
                  + `version number or install it manually when you're done:\n`
        console.warn(msg)
        console.log(`composer require drupal/${module}\n`.red)
      }
    })
    return composerJson
  },
  getModuleDirs: function(moduleDir) {
    return fs.readdirSync(moduleDir)
              .filter(dir => fs.statSync(path.join(moduleDir, dir)).isDirectory())
              .filter(dir => !(/(^|\/)\.[^\/\.]/g).test(dir))
  },
  shallowDiff: function(a, b) {
    const diffArr = _.difference(_.keys(a), _.keys(b))
    const diffObj = {}
    diffArr.map((item) => {
      diffObj[item] = a[item]
    })
    return diffObj
  },
  sortKeysBy: function (obj, comparator) {
    var keys = _.sortBy(_.keys(obj), (key) => {
      return comparator ? comparator(obj[key], key) : key
    })
    return _.zipObject(keys, _.map(keys, (key) => {
      return obj[key]
    }))
  },
  templateReplace: function(string, replacements) {
    return string.replace(
        /{(\w*)}/g, // or /{(\w*)}/g for "{this} instead of %this%"
        ( m, key ) => {
          return replacements.hasOwnProperty( key ) ? replacements[ key ] : ''
        })
  } 
}
 
module.exports = app;
