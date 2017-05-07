Drupal 8 Composer Conversion
============================
This module is meant to be run from the root of a project and 
will evaluate all installed modules in addition to those installed 
in the default drupal composer.json file

I created this because my agency used drush to install modules on a 
few sites only to realize afterwards that we were doing it wrong!
Rather than catalog the modules individually I figured I'd write some 
node (my favorite DevOps tool) to solve the problem.

This module assumes you have a repo structure similar to:  
```
app
--composer.json
--modules
----contrib
----custom
...etc...
```
_*where `app` contains the Drupal installation_

To start install the module globally:  
`npm install -g drupal-composer-convert`

Enter the root of a project and run the module:  
`drupal-composer-convert` 
