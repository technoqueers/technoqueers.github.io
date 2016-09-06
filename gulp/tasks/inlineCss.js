var gulp = require('gulp'),
    inlineCss = require('gulp-inline-css');

gulp.task('inlineCss', function() {
    return gulp.src('newsletter.html')
        .pipe(inlineCss())
        .pipe(gulp.dest('./'));
});
