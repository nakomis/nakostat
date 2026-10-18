Import("env")

# build_flags only reach the compiler; gcov instrumentation also needs the
# runtime linked in, so pass --coverage to the linker for the native tests.
env.Append(LINKFLAGS=["--coverage"])
