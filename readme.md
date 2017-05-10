Drupal 8 Composer Helper
========================
This module's primary function will combine modules that were added to the Drupal composer
file and those that were installed manually or via Drush to the `modules` directory.
It then pulls templates from the [Drupal Composer](https://github.com/drupal-composer/drupal-project) 
project as a base to build the new installation.  Reference that project's homepage 
for additional information on managing your project with composer moving forward.

I originally created this because my agency used drush to install modules
on a few sites only to realize afterwards that we were doing it wrong!
Rather than catalog the modules individually I figured I'd write some 
node (my favorite DevOps tool) to solve the problem.

It assumes you have a repo structure similar to:  
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
`npm install -g drupal-composer`

Enter the root of a project and run the module:  
`drupal-composer` 
